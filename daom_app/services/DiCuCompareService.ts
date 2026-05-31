import 'server-only';

import { DAOMEnvConfig } from '@/scheme/env';
import { DocIntelligenceService } from './DocIntelligenceService';
import { ContentUnderstandingService } from './ContentUnderstandingService';

export interface DiCuCompareRequest {
  fileUrl: string;
  diModelId?: string;
  cuAnalyzerId?: string;
  cuApiVersion?: string;
  includeRaw?: boolean;
  pollIntervalMs?: number;
  maxPolls?: number;
}

interface CompareSummary {
  content_length?: number;
  pages_count?: number;
  tables_count?: number;
  paragraphs_count?: number;
  top_level_keys?: string[];
  result_keys?: string[];
  fields_count?: number;
}

interface CompareResultSection {
  status: 'SUCCESS' | 'ERROR' | 'SKIPPED';
  elapsed_ms: number;
  error?: string;
  summary?: CompareSummary;
  raw?: unknown;
  model_id?: string;
  analyzer_id?: string;
  api_version?: string;
  operation_location?: string;
}

export interface DiCuCompareResult {
  status: 'SUCCESS' | 'PARTIAL_SUCCESS' | 'ERROR' | 'SKIPPED';
  started_at: string;
  completed_at: string;
  input: {
    file_url: string;
    di_model_id: string;
    cu_analyzer_id: string | null;
    cu_api_version: string | null;
  };
  di: CompareResultSection;
  cu: CompareResultSection;
}

export class DiCuCompareService {
  private envConfig: DAOMEnvConfig;

  constructor(envConfig: DAOMEnvConfig) {
    this.envConfig = envConfig;
  }

  private buildSkippedResult(
    request: DiCuCompareRequest,
    reason: string
  ): DiCuCompareResult {
    const now = new Date().toISOString();
    return {
      status: 'SKIPPED',
      started_at: now,
      completed_at: now,
      input: {
        file_url: request.fileUrl,
        di_model_id: request.diModelId || 'prebuilt-layout',
        cu_analyzer_id: request.cuAnalyzerId || null,
        cu_api_version: request.cuApiVersion || null,
      },
      di: {
        status: 'SKIPPED',
        elapsed_ms: 0,
        error: reason,
      },
      cu: {
        status: 'SKIPPED',
        elapsed_ms: 0,
        error: reason,
      },
    };
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private summarizeCuPollPayload(payload: unknown): CompareSummary {
    if (!payload || typeof payload !== 'object') return {};
    const obj = payload as Record<string, unknown>;
    const result = obj.result;
    if (!result || typeof result !== 'object') {
      return { top_level_keys: Object.keys(obj), result_keys: [] };
    }

    const resultObj = result as Record<string, unknown>;
    const fields = resultObj.fields;
    return {
      top_level_keys: Object.keys(obj),
      result_keys: Object.keys(resultObj),
      fields_count: fields && typeof fields === 'object'
        ? Object.keys(fields as Record<string, unknown>).length
        : 0,
    };
  }

  private logCompareResult(result: DiCuCompareResult): void {
    const payload = {
      status: result.status,
      started_at: result.started_at,
      completed_at: result.completed_at,
      input: {
        di_model_id: result.input.di_model_id,
        cu_analyzer_id: result.input.cu_analyzer_id,
        cu_api_version: result.input.cu_api_version,
      },
      di: {
        status: result.di.status,
        elapsed_ms: result.di.elapsed_ms,
        error: result.di.error || null,
        summary: result.di.summary || null,
      },
      cu: {
        status: result.cu.status,
        elapsed_ms: result.cu.elapsed_ms,
        error: result.cu.error || null,
        summary: result.cu.summary || null,
      },
    };

    if (result.status === 'SUCCESS') {
      console.info('[DI/CU Compare] result', payload);
      return;
    }

    console.warn('[DI/CU Compare] result', payload);
  }

  async compareFromUrl(request: DiCuCompareRequest): Promise<DiCuCompareResult> {
    const startedAtIso = new Date().toISOString();

    const diModelId = request.diModelId || 'prebuilt-layout';
    const cuResource = this.envConfig.content_understanding;
    const cuAnalyzerId = request.cuAnalyzerId || cuResource?.default_analyzer_id;
    const cuApiVersion = request.cuApiVersion || cuResource?.api_version || '2025-11-01';
    const includeRaw = request.includeRaw !== false;

    if (!cuResource?.endpoint || !cuResource?.key) {
      const skipped = this.buildSkippedResult(request, 'content_understanding 설정이 없어 DI/CU 비교를 건너뜁니다.');
      this.logCompareResult(skipped);
      return skipped;
    }
    if (!cuAnalyzerId) {
      const skipped = this.buildSkippedResult(request, 'cu_analyzer_id가 없어 DI/CU 비교를 건너뜁니다.');
      this.logCompareResult(skipped);
      return skipped;
    }

    const docIntelService = new DocIntelligenceService(this.envConfig);
    const contentUnderstandingService = new ContentUnderstandingService(this.envConfig);

    const diTask = (async () => {
      const start = Date.now();
      const result = await docIntelService.analyzeDocument(request.fileUrl, diModelId);
      const elapsedMs = Date.now() - start;
      return {
        result,
        elapsedMs,
      };
    })();

    const cuTask = contentUnderstandingService.analyzeFromUrl(
      request.fileUrl,
      cuAnalyzerId,
      {
        apiVersion: cuApiVersion,
        pollIntervalMs: request.pollIntervalMs,
        maxPolls: request.maxPolls,
      }
    );

    const [diSettled, cuSettled] = await Promise.allSettled([diTask, cuTask]);

    const diSection: CompareResultSection = {
      status: 'SKIPPED',
      elapsed_ms: 0,
      model_id: diModelId,
    };
    const cuSection: CompareResultSection = {
      status: 'SKIPPED',
      elapsed_ms: 0,
      analyzer_id: cuAnalyzerId,
      api_version: cuApiVersion,
    };

    if (diSettled.status === 'fulfilled') {
      diSection.status = 'SUCCESS';
      diSection.elapsed_ms = diSettled.value.elapsedMs;
      diSection.summary = {
        content_length: diSettled.value.result.content.length,
        pages_count: Array.isArray(diSettled.value.result.pages) ? diSettled.value.result.pages.length : 0,
        tables_count: Array.isArray(diSettled.value.result.tables) ? diSettled.value.result.tables.length : 0,
        paragraphs_count: Array.isArray(diSettled.value.result.paragraphs) ? diSettled.value.result.paragraphs.length : 0,
      };
      diSection.raw = includeRaw ? diSettled.value.result : undefined;
    } else {
      diSection.status = 'ERROR';
      diSection.error = this.toErrorMessage(diSettled.reason);
    }

    if (cuSettled.status === 'fulfilled') {
      cuSection.status = cuSettled.value.status === 'succeeded' ? 'SUCCESS' : 'ERROR';
      cuSection.elapsed_ms = cuSettled.value.elapsed_ms;
      cuSection.operation_location = cuSettled.value.operation_location;
      cuSection.summary = this.summarizeCuPollPayload(cuSettled.value.poll_response);
      if (cuSection.status === 'ERROR') {
        cuSection.error = `CU status=${cuSettled.value.status}`;
      }
      cuSection.raw = includeRaw
        ? {
            submit_response: cuSettled.value.submit_response,
            poll_response: cuSettled.value.poll_response,
          }
        : undefined;
    } else {
      cuSection.status = 'ERROR';
      cuSection.error = this.toErrorMessage(cuSettled.reason);
    }

    const finalStatus: DiCuCompareResult['status'] =
      diSection.status === 'SUCCESS' && cuSection.status === 'SUCCESS'
        ? 'SUCCESS'
        : (diSection.status === 'ERROR' && cuSection.status === 'ERROR')
          ? 'ERROR'
          : 'PARTIAL_SUCCESS';

    const result: DiCuCompareResult = {
      status: finalStatus,
      started_at: startedAtIso,
      completed_at: new Date().toISOString(),
      input: {
        file_url: request.fileUrl,
        di_model_id: diModelId,
        cu_analyzer_id: cuAnalyzerId,
        cu_api_version: cuApiVersion,
      },
      di: diSection,
      cu: cuSection,
    };

    this.logCompareResult(result);
    return result;
  }
}
