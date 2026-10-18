import { EXIT_CODES, type ErrorCode } from "@hush/schemas";

/**
 * Thin, typed HTTP client for the backend. Every error arrives as an
 * HushApiError carrying the server's code so commands can map it to a helpful
 * message and the right exit code.
 */

export class HushApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "network" | "unknown";
  readonly details: unknown;

  constructor(
    status: number,
    code: HushApiError["code"],
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "HushApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiClient {
  baseUrl: string;
  token: string | null;
  request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    options?: { body?: unknown; query?: Record<string, string | number | undefined> },
  ): Promise<T>;
  get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
}

export function createApiClient(options: { baseUrl: string; token?: string | null }): ApiClient {
  const baseUrl = options.baseUrl;

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    requestOptions: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(requestOptions.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    let bodyText: string | undefined;
    if (requestOptions.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyText = JSON.stringify(requestOptions.body);
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: bodyText });
    } catch (error) {
      throw new HushApiError(
        0,
        "network",
        `Could not reach ${baseUrl}. Check your connection or --api-url. (${error instanceof Error ? error.message : "network error"})`,
      );
    }

    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }

    if (!response.ok) {
      const errorBody = payload as
        | { error?: { code?: ErrorCode; message?: string; details?: unknown } }
        | undefined;
      const code = errorBody?.error?.code ?? "unknown";
      const message =
        errorBody?.error?.message ??
        `Request failed (HTTP ${response.status}). Try again, or run \`hush doctor\`.`;
      const error = new HushApiError(response.status, code, message, errorBody?.error?.details);
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        if (retryAfter) {
          error.message = `${message} (retry in ${retryAfter}s)`;
        }
      }
      throw error;
    }

    return payload as T;
  }

  return {
    baseUrl,
    token: options.token ?? null,
    request,
    get: <T>(path: string, query?: Record<string, string | number | undefined>) =>
      request<T>("GET", path, { query }),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
    del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, { body }),
  };
}

export function exitCodeForError(error: unknown): number {
  if (error instanceof HushApiError) {
    if (error.status === 401 || error.status === 403 || error.code === "unauthorized") {
      return EXIT_CODES.AUTH;
    }
    if (error.code === "conflict" || error.status === 409) {
      return EXIT_CODES.CONFLICT;
    }
    if (error.code === "validation" || error.status === 400) {
      return EXIT_CODES.USAGE;
    }
    return EXIT_CODES.ERROR;
  }
  return EXIT_CODES.ERROR;
}
