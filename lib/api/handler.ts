import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { ApiError, Errors } from './errors';
import { getSession } from '@/lib/auth/session';
import type { Session } from '@/lib/auth';

/**
 * Route-handler plumbing shared by every FamLink API endpoint.
 *
 * Two things it guarantees:
 *   - an unexpected throw becomes a generic 500 with no internal detail on
 *     the wire, and
 *   - authenticated handlers cannot forget to check the session, because the
 *     session is what they receive as an argument.
 */

export interface ApiSuccess<T> {
  data: T;
}

export interface ApiFailure {
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, init);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

function toResponse(error: unknown): NextResponse<ApiFailure> {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = {};

    if (error.status === 429 && typeof error.details === 'object' && error.details !== null) {
      const retry = (error.details as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (retry) headers['Retry-After'] = String(retry);
    }

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status, headers },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Some of those details need fixing.',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      { status: 422 },
    );
  }

  // Log server-side only. The client gets nothing that describes internals.
  console.error('[api] unhandled error', error);
  const internal = Errors.internal();
  return NextResponse.json(
    { error: { code: internal.code, message: internal.message } },
    { status: internal.status },
  );
}

type RouteContext<P> = { params: Promise<P> };

/** Wraps a public (unauthenticated) route handler. */
export function publicRoute<P = Record<string, never>>(
  handler: (req: Request, ctx: RouteContext<P>) => Promise<NextResponse> | NextResponse,
) {
  return async (req: Request, ctx: RouteContext<P>): Promise<NextResponse> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/**
 * Wraps a route handler that requires a signed-in caller.
 *
 * The session is resolved here and handed to the handler, so there is no code
 * path in which a handler runs without one.
 */
export function authedRoute<P = Record<string, never>>(
  handler: (
    req: Request,
    ctx: RouteContext<P> & { session: Session },
  ) => Promise<NextResponse> | NextResponse,
) {
  return async (req: Request, ctx: RouteContext<P>): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session) throw Errors.unauthorized();

      return await handler(req, { ...ctx, session });
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** Parses and validates a JSON body, turning malformed input into a 400. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;

  try {
    raw = await req.json();
  } catch {
    throw Errors.badRequest('Expected a JSON request body.');
  }

  return schema.parse(raw);
}

/** Parses and validates query-string parameters. */
export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams));
}
