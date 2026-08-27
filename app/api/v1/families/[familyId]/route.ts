import { authedRoute, ok, parseBody } from '@/lib/api/handler';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { getFamilyForMember, listFamilyMembers } from '@/lib/families/queries';
import { renameFamily } from '@/lib/families/service';
import { renameFamilySchema } from '@/lib/validation/family';
import { Errors } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { familyId: string };

/** GET /api/v1/families/:familyId — family plus its member list. */
export const GET = authedRoute<Params>(async (_req, { params, session }) => {
  const { familyId } = await params;

  const result = await getFamilyForMember(session.user.id, familyId);
  if (!result) throw Errors.notFound('That family');

  const members = await listFamilyMembers(session.user.id, familyId);

  return ok({
    family: result.family,
    membership: result.membership,
    members,
  });
});

/** PATCH /api/v1/families/:familyId — rename. Admin or owner only. */
export const PATCH = authedRoute<Params>(async (req, { params, session }) => {
  enforceRateLimit('mutation', session.user.id);

  const { familyId } = await params;
  const { name } = await parseBody(req, renameFamilySchema);

  const family = await renameFamily(session.user.id, familyId, name);
  return ok({ family });
});
