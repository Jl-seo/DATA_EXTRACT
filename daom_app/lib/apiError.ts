import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import CosmosDBService from '@/services/CosmosDBService';
import PermissionService from '@/services/PermissionService';
import { getCurrentEnvConfig } from '@/lib/env';
import { buildErrorTrace } from '@/lib/errorTrace';

type ApiErrorResponseOptions = {
  req?: NextRequest;
  source: string;
  error: unknown;
  status?: number;
  defaultMessage?: string;
  exposeMessage?: boolean;
  details?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const errorObj = asRecord(error);
  const nestedError = asRecord(errorObj?.error);
  return (
    pickString(errorObj, ['message']) ||
    pickString(nestedError, ['message']) ||
    fallback
  );
}

function normalizeErrorStack(error: unknown): string | null {
  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack.slice(0, 8000);
  }
  const errorObj = asRecord(error);
  const stack = pickString(errorObj, ['stack']);
  return stack ? stack.slice(0, 8000) : null;
}

async function persistApiError(options: {
  req?: NextRequest;
  source: string;
  errorId: string;
  status: number;
  errorMessage: string;
  stack: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const envConfig = await getCurrentEnvConfig();
    const cosmosDBService = new CosmosDBService(envConfig);
    const container = await cosmosDBService.getContainer('audit_logs');

    let userId = 'system';
    let userEmail = 'system@daom.local';
    try {
      const permissionService = new PermissionService(envConfig);
      const user = await permissionService.getCurrentUser();
      if (user?.oid) userId = user.oid;
      if (user?.upn) userEmail = user.upn;
    } catch {
      // 인증정보 조회 실패 시 시스템 계정으로 저장
    }

    const path = options.req ? new URL(options.req.url).pathname : options.source;
    const forwardedFor = options.req?.headers.get('x-forwarded-for') || null;
    const requestId =
      options.req?.headers.get('x-request-id') ||
      options.req?.headers.get('x-correlation-id') ||
      null;

    await container.items.create({
      id: options.errorId,
      timestamp: new Date().toISOString(),
      user_id: userId,
      user_email: userEmail,
      tenant_id: envConfig.id,
      action: 'READ',
      resource_type: 'settings',
      resource_id: options.source,
      status: 'FAILURE',
      changes: null,
      metadata: {
        kind: 'api_error',
        path,
        method: options.req?.method || null,
        http_status: options.status,
        request_id: requestId,
      },
      details: {
        error_message: options.errorMessage,
        error_stack: options.stack,
        ...(options.details || {}),
      },
      ip_address: forwardedFor ? forwardedFor.split(',')[0]?.trim() || null : null,
      user_agent: options.req?.headers.get('user-agent') || null,
    });
  } catch (persistError) {
    console.error('[ApiError] 에러 로그 저장 실패', persistError);
  }
}

export async function createApiErrorResponse(options: ApiErrorResponseOptions): Promise<NextResponse> {
  const status = options.status ?? 500;
  const defaultMessage = options.defaultMessage ?? 'Internal Server Error';
  const errorId = crypto.randomUUID();
  const errorMessage = normalizeErrorMessage(options.error, defaultMessage);
  const stack = normalizeErrorStack(options.error);
  const normalizedTrace = buildErrorTrace(options.error, {
    source: options.source,
  });
  const persistedDetails = {
    error_trace: normalizedTrace,
    ...(options.details || {}),
  };
  const timestamp = new Date().toISOString();

  console.error('[ApiError]', {
    errorId,
    source: options.source,
    status,
    message: errorMessage,
    stack,
    details: persistedDetails,
  });

  await persistApiError({
    req: options.req,
    source: options.source,
    errorId,
    status,
    errorMessage,
    stack,
    details: persistedDetails,
  });

  return NextResponse.json(
    {
      error: defaultMessage,
      error_id: errorId,
      timestamp,
      ...(options.exposeMessage ? { message: errorMessage } : {}),
    },
    { status }
  );
}
