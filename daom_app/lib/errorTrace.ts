function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(source: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function pickNumber(source: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function clampText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)} ...[truncated]`;
}

function normalizeUnknown(value: unknown, depth: number = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return clampText(value, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (depth >= 2) {
    return typeof value === 'object' ? '[Object]' : String(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => normalizeUnknown(item, depth + 1));
  }

  const obj = asRecord(value);
  if (!obj) return String(value);

  const entries = Object.entries(obj).slice(0, 30);
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    normalized[k] = normalizeUnknown(v, depth + 1);
  }
  return normalized;
}

function extractCause(error: unknown): unknown {
  if (error instanceof Error) {
    const errWithCause = error as Error & { cause?: unknown };
    if (errWithCause.cause !== undefined) {
      return normalizeUnknown(errWithCause.cause);
    }
  }
  const errorObj = asRecord(error);
  if (!errorObj || errorObj.cause === undefined) return undefined;
  return normalizeUnknown(errorObj.cause);
}

export function buildErrorTrace(
  error: unknown,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const errorObj = asRecord(error);
  const nestedError = asRecord(errorObj?.error);

  const message = (
    (error instanceof Error && error.message) ||
    pickString(errorObj, ['message']) ||
    pickString(nestedError, ['message']) ||
    String(error)
  );

  const stack = (() => {
    if (error instanceof Error && typeof error.stack === 'string') {
      return clampText(error.stack, 8000);
    }
    const stackText = pickString(errorObj, ['stack']) || pickString(nestedError, ['stack']);
    return stackText ? clampText(stackText, 8000) : undefined;
  })();

  const trace: Record<string, unknown> = {
    message: clampText(message, 4000),
    name: (error instanceof Error && error.name) || pickString(errorObj, ['name']),
    code: pickString(errorObj, ['code']) || pickString(nestedError, ['code']),
    status: pickNumber(errorObj, ['status', 'statusCode']) || pickNumber(nestedError, ['status', 'statusCode']),
    phase: pickString(errorObj, ['phase']) || pickString(nestedError, ['phase']),
    service: pickString(errorObj, ['service']) || pickString(nestedError, ['service']),
    model_id: pickString(errorObj, ['model_id']) || pickString(nestedError, ['model_id']),
    analyzer_id: pickString(errorObj, ['analyzer_id']) || pickString(nestedError, ['analyzer_id']),
    operation_location: pickString(errorObj, ['operation_location']) || pickString(nestedError, ['operation_location']),
    endpoint: pickString(errorObj, ['endpoint']) || pickString(nestedError, ['endpoint']),
    source_type: pickString(errorObj, ['source_type']) || pickString(nestedError, ['source_type']),
    details: normalizeUnknown(errorObj?.details ?? nestedError?.details),
    response_body: normalizeUnknown(errorObj?.response_body ?? nestedError?.response_body),
    submit_response: normalizeUnknown(errorObj?.submit_response ?? nestedError?.submit_response),
    poll_response: normalizeUnknown(errorObj?.poll_response ?? nestedError?.poll_response),
    cause: extractCause(error),
    stack,
    ...normalizeUnknown(extra) as Record<string, unknown>,
  };

  return Object.fromEntries(Object.entries(trace).filter(([, value]) => value !== undefined));
}
