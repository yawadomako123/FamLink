import { z } from 'zod';
import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { listCheckIns, listPendingForMe, requestCheckIn } from '@/lib/checkins/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  targetId: z.string().min(1),
  note: z.string().trim().max(200).optional(),
});

/** GET — check-ins awaiting my answer, plus recent history. */
export const GET = authedRoute<{ familyId: string }>(async (_req, { params, session }) => {
  const { familyId } = await params;

  const [pending, recent] = await Promise.all([
    listPendingForMe(session.user.id, familyId),
    listCheckIns(session.user.id, familyId),
  ]);

  return ok({ pending, recent });
});

/** POST — ask a family member if they're OK. */
export const POST = authedRoute<{ familyId: string }>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const { targetId, note } = await parseBody(req, schema);

  const checkIn = await requestCheckIn(session.user.id, familyId, targetId, note);
  return ok({ checkIn }, { status: 201 });
});
