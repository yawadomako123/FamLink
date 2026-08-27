'use client';

/**
 * Browser-side API client.
 *
 * Wraps fetch so every call returns either data or a typed error with the
 * server's user-facing message. Components render `error.message` directly —
 * the server owns the wording, which keeps error copy consistent and stops
 * components inventing their own phrasing for the same failure.
 */

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** True when retrying might plausibly help. */
  get isTransient(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

/** Thrown when the network itself failed, as opposed to the server refusing. */
export class NetworkError extends Error {
  constructor() {
    super('We could not reach FamLink. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}

interface ApiEnvelope<T> {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      // Location and family data must never be served from the HTTP cache.
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;

  let body: ApiEnvelope<T>;
  try {
    body = (await response.json()) as ApiEnvelope<T>;
  } catch {
    if (!response.ok) {
      throw new ApiClientError(response.status, 'UNKNOWN', 'Something went wrong. Please try again.');
    }
    return undefined as T;
  }

  if (!response.ok || body.error) {
    const error = body.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.details,
    );
  }

  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Normalises anything thrown by the client into a message safe to display. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError || error instanceof NetworkError) return error.message;
  return 'Something went wrong. Please try again.';
}
