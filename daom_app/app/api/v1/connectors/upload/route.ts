import { NextRequest, NextResponse, after } from "next/server";
import { getCurrentEnvConfig } from "@/lib/env";
import PermissionService from "@/services/PermissionService";
import CosmosDBService from "@/services/CosmosDBService";
import BlobStorageService from "@/services/BlobStorageService";
import { ConnectorService } from "@/services/ConnectorService";
import { createApiErrorResponse } from "@/lib/apiError";

export async function POST(req: NextRequest) {
    try {
        const payload = await req.json();
        const { model_id, metadata, webhook_url, file } = payload;

        if (!model_id || !file || !file.name || !file.contentBytes) {
            return NextResponse.json({ error: "Invalid payload. Requires model_id and file (name, contentBytes)" }, { status: 400 });
        }

        const envConfig = await getCurrentEnvConfig();
        const permissionService = new PermissionService(envConfig);
        const user = await permissionService.getCurrentUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        // 시스템 계정(익명 APIM 호출)은 업로드 금지 - 이메일 헤더 필수 기재 안내
        if (user.upn === 'apim-connector@system') {
            return NextResponse.json({ 
                error: "User identification required for upload. Please provide the 'X-MS-CLIENT-PRINCIPAL-NAME' header." 
            }, { status: 401 });
        }

        // 1. 객체/문자열 타입 처리 (PA $content wrapper 대응)
        const rawContent = file.contentBytes;
        let b64str = "";
        if (rawContent && typeof rawContent === 'object') {
            b64str = (rawContent as any)["$content"] || JSON.stringify(rawContent);
        } else {
            b64str = String(rawContent).trim();
        }

        // 2. JSON 문자열/Data URI/URL Encoding 전처리
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

        // 3. 1차 디코딩
        let fileContent = Buffer.from(b64str, 'base64');

        // 4. [SMART DECODING] 이중 인코딩 감지 및 자동 보정
        // 디코딩 결과가 여전히 파일 베이스64 헤더(PDF: JVBERi, Excel: UEsDB)라면 한 번 더 디코딩 시도
        const checkHeader = fileContent.slice(0, 5).toString();
        if (['JVBER', 'SlZCR', 'UEsDB', '0M8R4'].includes(checkHeader)) {
            console.log(`[Upload] Double Encoding detected for ${file.name} (Header: ${checkHeader}). Decoding once more...`);
            fileContent = Buffer.from(fileContent.toString().trim(), 'base64');
        }

        // 5. 데이터 무결성 최종 로깅
        const headerHex = fileContent.slice(0, 5).toString('hex');
        const headerText = fileContent.slice(0, 5).toString();
        console.log(`[Upload] Final File: ${file.name} | Size: ${fileContent.length} bytes | Header(hex): ${headerHex} | Header(text): ${headerText}`);

        if (fileContent.length < 10) {
            throw new Error(`파일 내용이 너무 작거나 비어있습니다. (${file.name})`);
        }

        const filename = file.name;
        const jobId = crypto.randomUUID();

        // Blob 업로드
        const blobStorageService = new BlobStorageService(envConfig);
        const blobPath = `connector/${jobId}/${filename}`;

        const cosmosDBService = new CosmosDBService(envConfig);
        const filesContainer = await cosmosDBService.getContainer('files');
        const parsedMetadata = metadata ? (typeof metadata === 'string' ? JSON.parse(metadata) : metadata) : null;

        await filesContainer.items.create({
            id: jobId, filename, blob_path: blobPath,
            size: fileContent.length,
            created_at: new Date().toISOString(),
            created_by: { name: user.name, object_id: user.oid, upn: user.upn },
            partition_key: envConfig.id || "default",
            metadata: parsedMetadata,
            webhook_url: webhook_url || null
        });

        await blobStorageService.uploadBuffer(fileContent, `${envConfig.id}/${blobPath}`, "application/octet-stream");

        // 추출 비동기 실행 (ConnectorService 사용)
        const reqHost = req.headers.get('host') || 'localhost:3000';
        const connectorService = new ConnectorService(envConfig, { name: user.name, upn: user.upn, oid: user.oid });

        after(async () => {
            try {
                await connectorService.runExtractionWithGroupWebhook(jobId, model_id, parsedMetadata, webhook_url, reqHost);
            } catch (err) {
                console.error(`[Upload] Background extraction failed for ${jobId}:`, err);
            }
        });

        return NextResponse.json({
            job_id: jobId,
            status: "pending",
            message: "추출 작업이 시작되었습니다",
            poll_url: `/api/v1/connectors/result/${jobId}`
        }, {
            status: 202,
            headers: { "Location": `/api/v1/connectors/result/${jobId}`, "Retry-After": "5" }
        });

    } catch (error: unknown) {
        return createApiErrorResponse({
            req,
            source: 'api/v1/connectors/upload',
            error,
            status: 500,
            defaultMessage: 'Internal Server Error',
            exposeMessage: true,
        });
    }
}
