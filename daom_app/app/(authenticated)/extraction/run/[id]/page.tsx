import { DocumentExtractionView } from '@/components/extraction/DocumentExtractionView';
import type { ExtractionLog, ExtractionModel } from '@/components/extraction/types';
import { getExtractionLog } from '@/actions/extractionLog';
import { getExtractionModel } from '@/actions/extractionModel';
import { getExtractionPermissionSummary } from '@/actions/permission';
import {
    EMPTY_EXTRACTION_PERMISSION_SUMMARY,
    type ExtractionPermissionSummary,
} from '@/lib/extractionPermission';

const buildFallbackModel = (
    modelId: string,
    log: ExtractionLog | undefined
): ExtractionModel | undefined => {
    if (!log) return undefined;

    const previewFields = log.preview_data?.model_fields || [];
    return {
        id: log.super_model_id || log.model_id || modelId,
        name: log.model_name || '모델',
        description: '',
        model_type: log.preview_data?.mode === 'comparison' ? 'comparison' : 'extraction',
        fields: previewFields.map((field) => ({
            key: field.key,
            label: field.label,
            type: 'text',
        })),
    };
};

interface PageProps {
    params: Promise<{
        id: string;
    }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ExtractionRunPage({ params, searchParams }: PageProps) {
    const { id } = await params;
    const resolvedSearchParams = await searchParams;
    const logId = typeof resolvedSearchParams.logId === 'string' ? resolvedSearchParams.logId : undefined;
    let initialLog: ExtractionLog | undefined;
    let resolvedModelId = id;

    if (logId) {
        try {
            initialLog = await getExtractionLog(logId) as ExtractionLog | undefined;
            if (initialLog?.super_model_id) {
                resolvedModelId = initialLog.super_model_id;
            } else if (initialLog?.model_id) {
                resolvedModelId = initialLog.model_id;
            }
        } catch (error) {
            console.error('[ExtractionRunPage] Failed to load initial log:', error);
        }
    }

    let initialModel: ExtractionModel | undefined;
    try {
        initialModel = await getExtractionModel(resolvedModelId) as ExtractionModel;
    } catch (error) {
        console.error('[ExtractionRunPage] Failed to load initial model:', error);
        initialModel = buildFallbackModel(resolvedModelId, initialLog);
    }

    let initialPermissionSummary: ExtractionPermissionSummary = EMPTY_EXTRACTION_PERMISSION_SUMMARY;
    try {
        initialPermissionSummary = await getExtractionPermissionSummary();
    } catch (error) {
        console.error('[ExtractionRunPage] Failed to load permission summary:', error);
    }

    return (
        <DocumentExtractionView
            modelId={resolvedModelId}
            initialLogId={logId}
            initialModel={initialModel}
            initialLog={initialLog}
            initialPermissionSummary={initialPermissionSummary}
        />
    );
}
