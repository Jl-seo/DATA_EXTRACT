import { NextRequest, NextResponse } from 'next/server';

import { getCurrentEnvConfig } from '@/lib/env';
import CosmosDBService from '@/services/CosmosDBService';
import BlobStorageService from '@/services/BlobStorageService';

type LogRecord = {
  id: string;
  model_id?: string;
  status?: string;
  debug_data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ logId: string }> }
) {
  try {
    const envConfig = await getCurrentEnvConfig();
    const requiredDebugKey = envConfig.connector_api_key;
    if (requiredDebugKey) {
      const providedDebugKey = req.headers.get('x-daom-debug-key') || '';
      if (providedDebugKey !== requiredDebugKey) {
        return NextResponse.json({ error: 'Unauthorized debug request' }, { status: 401 });
      }
    }

    const { logId } = await params;
    if (!logId?.trim()) {
      return NextResponse.json({ error: 'logId is required' }, { status: 400 });
    }

    const modelIdQuery = req.nextUrl.searchParams.get('modelId')?.trim();
    const cosmosDBService = new CosmosDBService(envConfig);
    const logsContainer = await cosmosDBService.getContainer('extraction_logs');

    let log: LogRecord | undefined;

    if (modelIdQuery) {
      try {
        const { resource } = await logsContainer.item(logId, modelIdQuery).read<LogRecord>();
        log = resource;
      } catch {
        log = undefined;
      }
    }

    if (!log) {
      const { resources } = await logsContainer.items.query({
        query: 'SELECT TOP 1 * FROM c WHERE c.id = @id ORDER BY c.created_at DESC',
        parameters: [{ name: '@id', value: logId }]
      }).fetchAll();
      log = resources[0] as LogRecord | undefined;
    }

    if (!log) {
      return NextResponse.json({ error: 'Log not found' }, { status: 404 });
    }

    let debugData = log.debug_data;
    if (BlobStorageService.isOffloadedReference(debugData)) {
      const blobStorageService = new BlobStorageService(envConfig);
      debugData = await blobStorageService.downloadJson(debugData.blob_path);
    }

    const compareData =
      isRecord(debugData) && 'di_cu_compare' in debugData
        ? (debugData as Record<string, unknown>).di_cu_compare
        : null;

    return NextResponse.json({
      status: 'SUCCESS',
      log_id: log.id,
      model_id: log.model_id || modelIdQuery || null,
      extraction_status: log.status || null,
      has_debug_data: debugData !== undefined && debugData !== null,
      has_di_cu_compare: compareData !== null,
      di_cu_compare: compareData,
    });
  } catch (error) {
    return NextResponse.json(
      { status: 'ERROR', error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

