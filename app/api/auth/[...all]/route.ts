import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

/**
 * Better Auth mounts its whole surface here: sign-up, sign-in, sign-out,
 * session, password reset. Node runtime is required because the underlying
 * database driver uses TCP sockets.
 */
export const runtime = 'nodejs';

export const { GET, POST } = toNextJsHandler(auth.handler);
