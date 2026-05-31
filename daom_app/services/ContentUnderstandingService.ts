import 'server-only';

import BaseService from './BaseService';
import { DAOMEnvConfig } from '@/scheme/env';
import { ContentUnderstandingResource } from '@/scheme/docIntel';

interface AnalyzeSubmitBody {
  inputs: Array<{ url: string }>;
}

export interface ContentUnderstandingAnalyzeResult {
  analyzer_id: string;
  api_version: string;
  operation_location: string;
  status: string;
  elapsed_ms: number;
  submit_response: unknown;
  poll_response: unknown;
}

export class ContentUnderstandingService extends BaseService {
  constructor(envConfig: DAOMEnvConfig) {
    super(envConfig);
  }

  private getResource(): ContentUnderstandingResource {
    const resource = this.envConfig.content_understanding;
    if (!resource?.endpoint || !resource.key) {
      throw new Error('content_understanding 설정(endpoint/key)이 없습니다.');
    }
    return resource;
  }

  private normalizeEndpoint(endpoint: string): string {
    return endpoint.replace(/\/+$/, '');
  }

  private buildAnalyzeUrl(endpoint: string, analyzerId: string, apiVersion: string): string {
    const encodedAnalyzerId = encodeURIComponent(analyzerId);
    return `${endpoint}/contentunderstanding/analyzers/${encodedAnalyzerId}:analyze?api-version=${encodeURIComponent(apiVersion)}`;
  }

  private toAbsoluteOperationLocation(endpoint: string, operationLocation: string): string {
    if (operationLocation.startsWith('http://') || operationLocation.startsWith('https://')) {
      return operationLocation;
    }
    if (operationLocation.startsWith('/')) {
      return `${endpoint}${operationLocation}`;
    }
    return `${endpoint}/${operationLocation}`;
  }

  private extractStatus(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const status = (payload as Record<string, unknown>).status;
    return typeof status === 'string' ? status.toLowerCase() : '';
  }

  private async parseJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw_text: text };
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private buildCuError(message: string, context: Record<string, unknown>): Error {
    const error = new Error(message) as Error & Record<string, unknown>;
    error.service = 'cu';
    for (const [k, v] of Object.entries(context)) {
      error[k] = v;
    }
    return error;
  }

  async analyzeFromUrl(
    fileUrl: string,
    analyzerIdInput?: string,
    options?: { apiVersion?: string; pollIntervalMs?: number; maxPolls?: number }
  ): Promise<ContentUnderstandingAnalyzeResult> {
    const resource = this.getResource();
    const endpoint = this.normalizeEndpoint(resource.endpoint);
    const apiVersion = options?.apiVersion || resource.api_version || '2025-11-01';
    const analyzerId = analyzerIdInput || resource.default_analyzer_id;

    if (!analyzerId) {
      throw new Error('CU analyzer_id가 필요합니다. 요청 본문 또는 env.content_understanding.default_analyzer_id를 설정하세요.');
    }

    const pollIntervalMs = options?.pollIntervalMs ?? 2000;
    const maxPolls = options?.maxPolls ?? 90;
    const startedAt = Date.now();

    const submitBody: AnalyzeSubmitBody = {
      inputs: [{ url: fileUrl }],
    };

    const analyzeUrl = this.buildAnalyzeUrl(endpoint, analyzerId, apiVersion);
    const submitResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': resource.key,
      },
      body: JSON.stringify(submitBody),
    });

    const submitPayload = await this.parseJsonResponse(submitResponse);
    if (!submitResponse.ok) {
      throw this.buildCuError(
        `[CU] analyze submit 실패: status=${submitResponse.status}`,
        {
          phase: 'submit',
          status: submitResponse.status,
          analyzer_id: analyzerId,
          api_version: apiVersion,
          endpoint,
          analyze_url: analyzeUrl,
          response_body: submitPayload,
        }
      );
    }

    const operationLocationHeader =
      submitResponse.headers.get('operation-location') ||
      submitResponse.headers.get('Operation-Location');

    if (!operationLocationHeader) {
      throw this.buildCuError(
        '[CU] operation-location 헤더가 없습니다.',
        {
          phase: 'submit',
          status: submitResponse.status,
          analyzer_id: analyzerId,
          api_version: apiVersion,
          endpoint,
          analyze_url: analyzeUrl,
          submit_response: submitPayload,
        }
      );
    }

    const operationLocation = this.toAbsoluteOperationLocation(endpoint, operationLocationHeader);
    let lastPayload: unknown = {};
    let lastStatus = '';

    for (let i = 0; i < maxPolls; i++) {
      const pollResponse = await fetch(operationLocation, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': resource.key,
        },
      });
      lastPayload = await this.parseJsonResponse(pollResponse);

      if (!pollResponse.ok) {
        throw this.buildCuError(
          `[CU] analyze poll 실패: status=${pollResponse.status}`,
          {
            phase: 'poll',
            status: pollResponse.status,
            analyzer_id: analyzerId,
            api_version: apiVersion,
            endpoint,
            operation_location: operationLocation,
            submit_response: submitPayload,
            poll_response: lastPayload,
          }
        );
      }

      lastStatus = this.extractStatus(lastPayload);
      if (lastStatus === 'succeeded') {
        return {
          analyzer_id: analyzerId,
          api_version: apiVersion,
          operation_location: operationLocation,
          status: lastStatus,
          elapsed_ms: Date.now() - startedAt,
          submit_response: submitPayload,
          poll_response: lastPayload,
        };
      }
      if (['failed', 'cancelled'].includes(lastStatus)) {
        throw this.buildCuError(
          `[CU] analyze 종료 상태 비정상: status=${lastStatus}`,
          {
            phase: 'poll_terminal',
            analyzer_id: analyzerId,
            api_version: apiVersion,
            endpoint,
            operation_location: operationLocation,
            submit_response: submitPayload,
            poll_response: lastPayload,
          }
        );
      }

      await this.sleep(pollIntervalMs);
    }

    throw this.buildCuError(
      '[CU] analyze poll timeout',
      {
        phase: 'poll_timeout',
        analyzer_id: analyzerId,
        api_version: apiVersion,
        endpoint,
        operation_location: operationLocation,
        elapsed_ms: Date.now() - startedAt,
        max_polls: maxPolls,
        poll_interval_ms: pollIntervalMs,
        submit_response: submitPayload,
        poll_response: lastPayload,
      }
    );
  }
}
