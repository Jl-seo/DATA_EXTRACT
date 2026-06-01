// app/_lib/api.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createApiErrorResponse } from '@/lib/apiError';


type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type ParseFrom = 'query' | 'body';

// 입력 있는 핸들러
type ApiHandlerWithInput<TInput, TResult> = (args: {
  req: NextRequest;
  input: TInput;
}) => Promise<TResult> | TResult;

// 입력 없는 핸들러
type ApiHandlerNoInput<TResult> = (args: {
  req: NextRequest;
}) => Promise<TResult> | TResult;

// 1) 입력 있는 버전
export function makeApi<TSchema extends z.ZodType, TResult>(options: {
  method: HttpMethod;
  schema: TSchema;
  parseFrom?: ParseFrom;
  handler: ApiHandlerWithInput<z.output<TSchema>, TResult>;
}): (req: NextRequest) => Promise<NextResponse>;

// 2) 입력 없는 버전 (schema 없어도 됨)
export function makeApi<TResult>(options: {
  method: HttpMethod;
  handler: ApiHandlerNoInput<TResult>;
}): (req: NextRequest) => Promise<NextResponse>;

// 실제 구현
export function makeApi(options: any) {
  const { method } = options;

  const hasSchema = !!options.schema;

  const parseFrom: ParseFrom =
    options.parseFrom ?? (method === 'GET' ? 'query' : 'body');

  return async function route(req: NextRequest) {
    try {
      if (req.method?.toUpperCase() !== method) {
        return NextResponse.json(
          { error: 'Method Not Allowed' },
          { status: 405 },
        );
      }

      let input: unknown = undefined;

      if (hasSchema) {
        let raw: unknown;

        if (parseFrom === 'query') {
          const url = new URL(req.url);
          const queryObj: Record<string, string> = {};
          url.searchParams.forEach((value, key) => {
            queryObj[key] = value;
          });
          raw = queryObj;
        } else {
          raw = (await req.json().catch(() => ({}))) ?? {};
        }

        input = options.schema.parse(raw);
        const result = await options.handler({ req, input });
        return NextResponse.json(result);
      } else {
        // 입력 없이 handler 호출
        const result = await options.handler({ req });
        return NextResponse.json(result);
      }
    } catch (err) {
      console.error(err);

      if (err instanceof z.ZodError) {
        return NextResponse.json(
          {
            error:
              parseFrom === 'query'
                ? 'Invalid query'
                : 'Invalid body',
            issues: err.issues,
          },
          { status: 400 },
        );
      }

      return createApiErrorResponse({
        req,
        source: `lib/makeApi:${method}`,
        error: err,
        status: 500,
        defaultMessage: 'Internal Server Error',
      });
    }
  };
}
