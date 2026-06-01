import { NextRequest, NextResponse, after } from "next/server";
import pLimit from "p-limit";
import { getCurrentEnvConfig } from "@/lib/env";
import PermissionService from "@/services/PermissionService";
import CosmosDBService from "@/services/CosmosDBService";
import BlobStorageService from "@/services/BlobStorageService";
import { ConnectorService } from "@/services/ConnectorService";
import { createApiErrorResponse } from "@/lib/apiError";

export async function POST(req: NextRequest) {
    try {
        const rawPayload = await req.json();

        // 1. 페이로드 구조 유연하게 대응
        const getVal = (obj: any, key: string) => {
            if (obj[key] !== undefined) return obj[key];
            if (obj[`body/${key}`] !== undefined) return obj[`body/${key}`];
            if (obj.parameters) {
                if (obj.parameters[key] !== undefined) return obj.parameters[key];
                if (obj.parameters[`body/${key}`] !== undefined) return obj.parameters[`body/${key}`];
            }
            return undefined;
        };

        const model_id = getVal(rawPayload, 'model_id');
        const metadata = getVal(rawPayload, 'metadata');
        const webhook_url = getVal(rawPayload, 'webhook_url');
        const files = getVal(rawPayload, 'files');

        const parsedMetadata = metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : null;

        if (!model_id || !files || !Array.isArray(files)) {
            return NextResponse.json({
                error: "Invalid payload. Requires model_id and files array",
                received: Object.keys(rawPayload)
            }, { status: 400 });
        }

        const envConfig = await getCurrentEnvConfig();
        const permissionService = new PermissionService(envConfig);
        const user = await permissionService.getCurrentUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (user.upn === 'apim-connector@system') {
            return NextResponse.json({ 
                error: "User identification required for batch upload. Please provide the 'X-MS-CLIENT-PRINCIPAL-NAME' header." 
            }, { status: 401 });
        }

        const reqHost = req.headers.get('host') || 'localhost:3000';
        const batchResults: any[] = [];
        const filesToProcess: any[] = [];

        // 2. 응답을 위한 즉시 Job ID 생성 및 결과 목록 구성
        for (const file of files) {
            const jobId = crypto.randomUUID();
            const filename = file.name || "unknown";

            if (!file.name || !file.contentBytes) {
                batchResults.push({ filename, status: "error", message: "Invalid file object" });
                continue;
            }

            filesToProcess.push({ ...file, jobId });
            batchResults.push({
                filename,
                job_id: jobId,
                status: "pending",
                message: "업로드 및 추출 작업이 예약되었습니다.",
                poll_url: `/api/v1/connectors/result/${jobId}`
            });
        }

        // 3. 중량 작업(DB, Blob, Extraction)은 after() 블록에서 비동기로 처리
        after(async () => {
            console.log(`[BatchUpload] Starting background processing for ${filesToProcess.length} files...`);
            
            const limit = pLimit(4); // 최대 4개씩 동시 처리하여 대기열 완화 (TPM 100k 기준)
            const blobStorageService = new BlobStorageService(envConfig);
            const cosmosDBService = new CosmosDBService(envConfig);
            const filesContainer = await cosmosDBService.getContainer('files');
            const connectorService = new ConnectorService(envConfig, { name: user.name, upn: user.upn, oid: user.oid });

            await Promise.all(filesToProcess.map(file => limit(async () => {
                const jobId = file.jobId;
                const filename = file.name;

                try {
                    const rawContent = file.contentBytes;
                    let b64str = "";

                    // Base64 전처리 (기존 로직 유지)
                    if (rawContent && typeof rawContent === 'object') {
                        b64str = (rawContent as any)["$content"] || JSON.stringify(rawContent);
                    } else {
                        b64str = String(rawContent).trim();
                    }

                    if (b64str.startsWith("{")) {
                        try {
                            const parsed = JSON.parse(b64str);
                            b64str = parsed["$content"] || parsed["content"] || b64str;
                        } catch { /* ignore */ }
                    }
                    if (b64str.includes('%')) {
                        try { b64str = decodeURIComponent(b64str); } catch { /* ignore */ }
                    }
                    if (b64str.includes(",")) b64str = b64str.split(",")[1];

                    let fileContent = Buffer.from(b64str, 'base64');

                    // 이중 인코딩 보정
                    const checkHeader = fileContent.slice(0, 5).toString();
                    if (['JVBER', 'SlZCR', 'UEsDB', '0M8R4'].includes(checkHeader)) {
                        fileContent = Buffer.from(fileContent.toString().trim(), 'base64');
                    }

                    if (fileContent.length < 5) {
                        throw new Error(`파일 내용이 손상되었거나 비어있습니다.`);
                    }

                    const blobPath = `connector/${jobId}/${filename}`;

                    // DB 레코드 생성 (비동기 처리의 첫 관문)
                    await filesContainer.items.create({
                        id: jobId,
                        filename: filename,
                        blob_path: blobPath,
                        size: fileContent.length,
                        created_at: new Date().toISOString(),
                        created_by: { name: user.name, object_id: user.oid, upn: user.upn },
                        partition_key: envConfig.id || "default",
                        metadata: parsedMetadata,
                        webhook_url: webhook_url || null
                    });

                    // Blob 업로드
                    await blobStorageService.uploadBuffer(fileContent, `${envConfig.id}/${blobPath}`, "application/octet-stream");

                    // 실제 추출 서비스 호출
                    await connectorService.runExtractionWithGroupWebhook(jobId, model_id, parsedMetadata, webhook_url, reqHost);
                    console.log(`[BatchUpload] Background job finished for ${jobId} (${filename})`);

                } catch (err: any) {
                    console.error(`[BatchUpload] Critical error for ${filename} (${jobId}):`, err);
                    // TODO: 필요한 경우 별도의 에러 로깅이나 알림 처리
                }
            })));
            
            console.log(`[BatchUpload] All deferred background tasks assigned.`);
        });

        // 4. 즉시 202 응답
        const responseHeaders: Record<string, string> = {};
        if (filesToProcess.length > 0) {
            responseHeaders["Location"] = `/api/v1/connectors/result/${filesToProcess[0].jobId}`;
            responseHeaders["Retry-After"] = "5";
        }

        return NextResponse.json({
            batch_status: filesToProcess.length > 0 ? "success" : "error",
            message: "일괄 업로드 요청이 접수되었습니다. 백그라운드에서 처리가 시작됩니다.",
            results: batchResults
        }, { status: 202, headers: responseHeaders });

    } catch (error: unknown) {
        return createApiErrorResponse({
            req,
            source: 'api/v1/connectors/batch-upload',
            error,
            status: 500,
            defaultMessage: 'Internal Server Error',
            exposeMessage: true,
        });
    }
}
