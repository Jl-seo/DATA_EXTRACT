import { NextRequest, NextResponse } from "next/server";
import { getCurrentEnvConfig } from "@/lib/env";
import PermissionService from "@/services/PermissionService";
import CosmosDBService from "@/services/CosmosDBService";
import BlobStorageService from "@/services/BlobStorageService";
import { createApiErrorResponse } from "@/lib/apiError";

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
    try {
        const jobId = (await params).jobId;
        if (!jobId) return NextResponse.json({ error: "Job ID required" }, { status: 400 });

        const envConfig = await getCurrentEnvConfig();
        const permissionService = new PermissionService(envConfig);
        const user = await permissionService.getCurrentUser();
        // Allow anonymous polling if SAS used? Power automate usually uses auth token.        
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const cosmosDBService = new CosmosDBService(envConfig);
        const logsContainer = await cosmosDBService.getContainer('extraction_logs');

        // Search by log id OR file id (connector uploads often use file id as job id)
        const { resources: logs } = await logsContainer.items.query({
            query: "SELECT * FROM c WHERE c.id = @id OR c.file.id = @id ORDER BY c.created_at DESC",
            parameters: [{ name: "@id", value: jobId }]
        }).fetchAll();

        const log = logs[0];
        if (!log) return NextResponse.json({ error: "Job not found" }, { status: 404 });

        const blobStorageService = new BlobStorageService(envConfig);
        let previewData: any = log.preview_data || null;

        // preview_data가 오프로딩된 경우 실제 JSON을 로드하여 사용
        if (previewData?._is_offloaded && previewData.blob_path) {
            try {
                previewData = await blobStorageService.downloadJson(previewData.blob_path);
            } catch (error) {
                console.error(`[Connector Result] Offloaded preview_data 로드 실패 (jobId=${jobId})`, error);
            }
        }

        // Security check
        if (log.created_by?.object_id !== user.oid) {
            // Check if superadmin or model admin here...
            // For simplicity in this mock integration:
            if (!user.roles?.includes('DAOM.SuperAdmin')) {
                return NextResponse.json({ error: "Access denied" }, { status: 403 });
            }
        }

        const isDone = ["success", "completed", "preview_ready"].includes((log.status || "").toLowerCase());
        const isErr = ["error", "failed"].includes((log.status || "").toLowerCase());

        // Extract confidence scores from preview_data
        const confidenceData: Record<string, number> = {};
        if (isDone && previewData?.guide_extracted) {
            Object.entries(previewData.guide_extracted).forEach(([key, field]: [string, any]) => {
                if (field && typeof field === 'object' && 'confidence' in field) {
                    confidenceData[key] = field.confidence;
                }
            });
        }

        const taggedText =
            isDone && previewData?.beta_metadata && typeof previewData.beta_metadata === 'object'
                ? (previewData.beta_metadata as any).parsed_content || null
                : null;

        // Lookup super_model_id if not in log (for backward compatibility)
        let superModelId = log.super_model_id;
        if (!superModelId) {
            const modelContainer = await cosmosDBService.getContainer('extraction_models');
            const { resources: superModels } = await modelContainer.items.query({
                query: 'SELECT c.id FROM c WHERE ARRAY_CONTAINS(c.sub_model_ids, @modelId)',
                parameters: [{ name: '@modelId', value: log.model_id }]
            }).fetchAll();
            if (superModels[0]) superModelId = superModels[0].id;
        }

        const responseData: any = {
            job_id: jobId,
            log_id: log.id,
            status: log.status,
            model_id: log.model_id,
            super_model_id: superModelId || null,
            filename: log.filename,
            extracted_data: isDone ? log.extracted_data : null,
            confidence_data: isDone ? confidenceData : null, // Add confidence data
            tagged_text: taggedText,
            is_table: Array.isArray(log.extracted_data),
            error: isErr ? log.error_message || log.error : null,
            metadata: log.metadata || null,
            webhook_url: log.webhook_url || null,
            created_at: log.created_at
        };

        if (log.status === "processing" || log.status === "pending") {
            return NextResponse.json(responseData, {
                status: 202,
                headers: {
                    "Retry-After": "5",
                    "Location": `/api/v1/connectors/result/${jobId}`
                }
            });
        }

        return NextResponse.json(responseData);

    } catch (error: unknown) {
        return createApiErrorResponse({
            req,
            source: 'api/v1/connectors/result',
            error,
            status: 500,
            defaultMessage: 'Internal Server Error',
            exposeMessage: true,
        });
    }
}
