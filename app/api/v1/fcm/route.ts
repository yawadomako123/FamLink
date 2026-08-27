import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { db } from '@/lib/db';
import { pushSubscriptions } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  token: z.string().min(1),
  userAgent: z.string().optional(),
});

export const POST = authedRoute(async (req, { session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { token, userAgent } = await parseBody(req, schema);

  await db.insert(pushSubscriptions).values({
    userId: session.user.id,
    token,
    userAgent,
  }).onConflictDoUpdate({
    target: [pushSubscriptions.token],
    set: { userId: session.user.id, userAgent, updatedAt: new Date() },
  });

  return ok({ success: true });
});
