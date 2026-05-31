import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentEnvConfig } from '@/lib/env';
import { DocIntelligenceService } from '@/services/DocIntelligenceService';
import { ContentUnderstandingService } from '@/services/ContentUnderstandingService';

const CompareRequest = z.object({
  file_url: z.string().url(),
  di_model_id: z.string().trim().min(1).default('prebuilt-layout'),
  cu_analyzer_id: z.string().trim().min(1).optional(),
  cu_api_version: z.string().trim().min(1).optional(),
  poll_interval_ms: z.number().int().min(500).max(10000).default(2000),
  max_polls: z.number().int().min(1).max(300).default(90),
  include_raw: z.boolean().default(true),
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function summarizeCuPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const obj = payload as Record<string, unknown>;
  const result = obj.result;
  const resultObj = (result && typeof result === 'object') ? (result as Record<string, unknown>) : undefined;
  const fields = resultObj?.fields;
  const pages = resultObj?.pages;

  return {
    top_level_keys: Object.keys(obj),
    result_keys: resultObj ? Object.keys(resultObj) : [],
    fields_count: fields && typeof fields === 'object' ? Object.keys(fields as Record<string, unknown>).length : 0,
    pages_count: Array.isArray(pages) ? pages.length : 0,
  };
}

export async function POST(req: NextRequest) {
  try {
    const envConfig = await getCurrentEnvConfig();
    const requiredDebugKey = envConfig.connector_api_key;
    if (requiredDebugKey) {
      const providedDebugKey = req.headers.get('x-daom-debug-key') || '';
      if (providedDebugKey !== requiredDebugKey) {
        return NextResponse.json({ error: 'Unauthorized debug request' }, { status: 401 });
      }
    }

    const parsedBody = CompareRequest.parse(await req.json());
    const docIntelService = new DocIntelligenceService(envConfig);
    const contentUnderstandingService = new ContentUnderstandingService(envConfig);

    const diTask = (async () => {
      const startedAt = Date.now();
      const result = await docIntelService.analyzeDocument(parsedBody.file_url, parsedBody.di_model_id);
      return { result, elapsed_ms: Date.now() - startedAt };
    })();

    const cuTask = contentUnderstandingService.analyzeFromUrl(
      parsedBody.file_url,
      parsedBody.cu_analyzer_id,
      {
        apiVersion: parsedBody.cu_api_version,
        pollIntervalMs: parsedBody.poll_interval_ms,
        maxPolls: parsedBody.max_polls,
      }
    );

    const [diResult, cuResult] = await Promise.allSettled([diTask, cuTask]);

    const responsePayload: Record<string, unknown> = {
      status: 'SUCCESS',
      compared_at: new Date().toISOString(),
      input: {
        file_url: parsedBody.file_url,
        di_model_id: parsedBody.di_model_id,
        cu_analyzer_id: parsedBody.cu_analyzer_id || null,
      },
    };

    if (diResult.status === 'fulfilled') {
      responsePayload.di = {
        model_id: parsedBody.di_model_id,
        elapsed_ms: diResult.value.elapsed_ms,
        summary: {
          content_length: diResult.value.result.content.length,
          pages_count: Array.isArray(diResult.value.result.pages) ? diResult.value.result.pages.length : 0,
          tables_count: Array.isArray(diResult.value.result.tables) ? diResult.value.result.tables.length : 0,
          paragraphs_count: Array.isArray(diResult.value.result.paragraphs) ? diResult.value.result.paragraphs.length : 0,
        },
        raw: parsedBody.include_raw ? diResult.value.result : undefined,
      };
    } else {
      responsePayload.di = {
        error: toErrorMessage(diResult.reason),
      };
    }

    if (cuResult.status === 'fulfilled') {
      responsePayload.cu = {
        analyzer_id: cuResult.value.analyzer_id,
        api_version: cuResult.value.api_version,
        operation_location: cuResult.value.operation_location,
        elapsed_ms: cuResult.value.elapsed_ms,
        status: cuResult.value.status,
        summary: summarizeCuPayload(cuResult.value.poll_response),
        raw: parsedBody.include_raw
          ? {
              submit_response: cuResult.value.submit_response,
              poll_response: cuResult.value.poll_response,
            }
          : undefined,
      };
    } else {
      responsePayload.cu = {
        error: toErrorMessage(cuResult.reason),
      };
    }

    const hasDiError =
      diResult.status === 'rejected';
    const hasCuError =
      cuResult.status === 'rejected';

    if (hasDiError && hasCuError) {
      responsePayload.status = 'ERROR';
      return NextResponse.json(responsePayload, { status: 502 });
    }
    if (hasDiError || hasCuError) {
      responsePayload.status = 'PARTIAL_SUCCESS';
    }

    return NextResponse.json(responsePayload);
  } catch (error) {
    return NextResponse.json(
      { status: 'ERROR', error: toErrorMessage(error) },
      { status: 400 }
    );
  }
}
