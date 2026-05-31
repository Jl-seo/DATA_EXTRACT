import {
  QueryClient,
  QueryFunctionContext,
  QueryKey,
  defaultShouldDehydrateQuery,
  isServer,
} from '@tanstack/react-query';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000,
        queryFn: defaultQueryFn,
      },
      dehydrate: {
        // per default, only successful Queries are included,
        // this includes pending Queries as well
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === 'pending',
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DefaultQueryFunctionContext extends QueryFunctionContext { }

export type FetchParams = {
  queryKey: QueryKey;
  pageParam?: unknown;
};


interface QueryFnRequest extends RequestInit {
  params?: Record<string, any>;
  data?: Record<string, any>;
  url?: string;
}


export async function defaultQueryFn<T>({ queryKey, pageParam }: FetchParams) {
  let options: QueryFnRequest = {};
  let path = '';

  if (typeof queryKey[queryKey.length - 1] === 'object') {
    options = {
      ...(queryKey[queryKey.length - 1] as QueryFnRequest),
    };
  }

  if (options.url) {
    path = options.url;
  } else if (typeof queryKey[0] === 'string') {
    path = queryKey[0];
  }
  let url = path.startsWith('/') ? '/api' + path : path;

  const params = {
    ...(options.params ?? {}),
    ...(pageParam ?? {}),
  };

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    searchParams.append(key, String(value));
  });

  if (searchParams.toString()) {
    url += `?${searchParams.toString()}`;
  }

  options.headers = {
    'content-type': 'application/json; charset=utf-8',
    ...(options?.headers ?? {}),
  };

  const method = (options?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    options.body = JSON.stringify({
      ...(options.data ?? {}),
      ...(pageParam ?? {}),
    });
  }

  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    console.error(response);
    let errorMessage = 'Request failed';
    try {
      const errorData = await response.json();
      errorMessage = (errorData as any)?.message ?? errorMessage;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

export function deferForQuery<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  ...args: TArgs
): () => Promise<TResult> {
  return () =>
    new Promise<TResult>((resolve, reject) => {
      setTimeout(() => {
        fn(...args).then(resolve).catch(reject);
      }, 0);
    });
}
