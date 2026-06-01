interface ActionResponseSuccess<T> {
  error?: undefined;
  result: T;
  errorMessage?: undefined;
}

interface ActionResponseError {
  error: true;
  errorMessage: string;
  result?: undefined;
}

export type ActionResponse<T = unknown> =
  | ActionResponseSuccess<T>
  | ActionResponseError;
