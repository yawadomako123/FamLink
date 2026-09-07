import 'server-only';

import { and, count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  accounts,
  calls,
  emergencyEvents,
  families,
  familyMembers,
  messages,
  places,
  pushSubscriptions,
  sessions,
  users,
} from '@/lib/db/schema';
import { Errors } from '@/lib/api/errors';
import { requirePlatformAdmin } from './guard';

/**
 * What an operator can see.
 *
 * ## The line this module draws
 *
 * Counts, never contents. An admin can learn that a family sent four hundred
 * messages and nothing about what any of them said; that somebody is sharing
 * their location and not where they are; that a voice note exists and never
 * how to play it.
 *
 * This is not caution for its own sake. FamLink's whole architecture rests on
 * family membership being the thing that grants access to family data — it is
 * why voice notes are served through a membership check rather than a public
 * URL, and why the realtime channel carries invalidation hints instead of
 * payloads. An admin screen that read message bodies or coordinates would
 * undo all of that from the inside, and would do it for every family at once.
 *
 * So no query here selects `messages.content`, `locations.latitude`,
 * `messages.audioPath`, or anything else a family would reasonably consider
 * theirs. Operating the service does not require reading it, and the moment
 * that stops being true it should be a deliberate decision with its own
 * design, not a column quietly added to a SELECT.
 */

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export interface PlatformOverview {
  users: { total: number; withGoogle: number; activeSessions: number; newThisWeek: number };
  families: { total: number; averageSize: number; largest: number };
  activity: {
    messages: number;
    messagesThisWeek: number;
    calls: number;
    callsThisWeek: number;
    places: number;
    sosAllTime: number;
    sosActive: number;
  };
  reach: { pushSubscriptions: number; sharingLocation: number };
}

function weekAgo(): Date {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

/** One number each, for the top of the dashboard. */
export async function platformOverview(): Promise<PlatformOverview> {
  await requirePlatformAdmin();

  const since = weekAgo();
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

  /*
   * Issued together. Individually they are trivial; a dozen sequential round
   * trips to a pooled Postgres on another continent is not.
   */
  const [
    totalUsers,
    googleUsers,
    activeSessions,
    newUsers,
    totalFamilies,
    memberships,
    largestFamily,
    totalMessages,
    weekMessages,
    totalCalls,
    weekCalls,
    totalPlaces,
    sosAll,
    sosActive,
    pushes,
    sharing,
  ] = await Promise.all([
    one(db.select({ n: count() }).from(users)),
    one(
      db
        .select({ n: sql<number>`count(distinct ${accounts.userId})::int` })
        .from(accounts)
        .where(eq(accounts.providerId, 'google')),
    ),
    one(
      db
        .select({ n: count() })
        .from(sessions)
        .where(gte(sessions.expiresAt, new Date())),
    ),
    one(db.select({ n: count() }).from(users).where(gte(users.createdAt, since))),
    one(db.select({ n: count() }).from(families)),
    one(db.select({ n: count() }).from(familyMembers)),
    one(
      db
        .select({ n: sql<number>`coalesce(max(c), 0)::int` })
        .from(
          db
            .select({ c: sql<number>`count(*)::int as c` })
            .from(familyMembers)
            .groupBy(familyMembers.familyId)
            .as('sizes'),
        ),
    ),
    one(db.select({ n: count() }).from(messages)),
    one(db.select({ n: count() }).from(messages).where(gte(messages.createdAt, since))),
    one(db.select({ n: count() }).from(calls)),
    one(db.select({ n: count() }).from(calls).where(gte(calls.startedAt, since))),
    one(db.select({ n: count() }).from(places)),
    one(db.select({ n: count() }).from(emergencyEvents)),
    one(
      db
        .select({ n: count() })
        .from(emergencyEvents)
        .where(eq(emergencyEvents.status, 'active')),
    ),
    one(db.select({ n: count() }).from(pushSubscriptions)),
    one(
      db
        .select({ n: count() })
        .from(familyMembers)
        .where(eq(familyMembers.locationSharingState, 'sharing')),
    ),
  ]);

  return {
    users: {
      total: totalUsers,
      withGoogle: googleUsers,
      activeSessions,
      newThisWeek: newUsers,
    },
    families: {
      total: totalFamilies,
      averageSize: totalFamilies === 0 ? 0 : Math.round((memberships / totalFamilies) * 10) / 10,
      largest: largestFamily,
    },
    activity: {
      messages: totalMessages,
      messagesThisWeek: weekMessages,
      calls: totalCalls,
      callsThisWeek: weekCalls,
      places: totalPlaces,
      sosAllTime: sosAll,
      sosActive,
    },
    reach: { pushSubscriptions: pushes, sharingLocation: sharing },
  };
}

/* -------------------------------------------------------------------------- */
/* Growth                                                                      */
/* -------------------------------------------------------------------------- */

export interface DailyCount {
  day: string;
  users: number;
  families: number;
}

/**
 * Sign-ups and new families per day.
 *
 * Generated from a date series rather than from the rows, so a day on which
 * nothing happened appears as a zero instead of vanishing — a chart that
 * silently drops its empty days makes a flat week look like a busy one.
 */
export async function dailyGrowth(days = 30): Promise<DailyCount[]> {
  await requirePlatformAdmin();

  const span = Math.min(Math.max(days, 1), 365);

  const rows = await db.execute<{ day: string; users: number; families: number }>(sql`
    with series as (
      select generate_series(
        (current_date - ${sql.raw(String(span - 1))} * interval '1 day')::date,
        current_date,
        interval '1 day'
      )::date as day
    )
    select
      to_char(series.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from users u where u."createdAt"::date = series.day) as users,
      (select count(*)::int from families f where f.created_at::date = series.day) as families
    from series
    order by series.day
  `);

  return (rows.rows ?? []).map((r) => ({
    day: r.day,
    users: Number(r.users),
    families: Number(r.families),
  }));
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isPlatformAdmin: boolean;
  emailVerified: boolean;
  providers: string[];
  families: number;
  activeSessions: number;
  createdAt: Date;
}

/*
 * A note on the correlated subqueries below.
 *
 * They spell out `"users"."id"` rather than interpolating the column, because
 * Drizzle renders an interpolated column as a bare `"id"` and Postgres resolves
 * a bare name against the innermost table in scope. Inside
 * `from family_members fm` that is `family_members.id`, so the condition
 * silently became `fm.user_id = fm.id` — which is a type error in one place and,
 * worse, a query that quietly counts nothing in another.
 */

/** One page of accounts, newest first, optionally filtered by name or email. */
export async function listUsers({
  search,
  limit = 50,
  offset = 0,
}: { search?: string; limit?: number; offset?: number } = {}): Promise<{
  rows: AdminUserRow[];
  total: number;
}> {
  await requirePlatformAdmin();

  const take = Math.min(Math.max(limit, 1), 200);
  const term = search?.trim();

  // ilike on both columns: an operator looking somebody up has either half of
  // their name or a fragment of the address, rarely the whole of either.
  const where = term
    ? or(ilike(users.name, `%${term}%`), ilike(users.email, `%${term}%`))
    : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        isPlatformAdmin: users.isPlatformAdmin,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        // The empty default needs its type spelled out: Postgres cannot
        // resolve coalesce(text[], unknown) and refuses the whole statement.
        providers: sql<string[]>`coalesce(
          (select array_agg(distinct a."providerId") from accounts a where a."userId" = "users"."id"),
          '{}'::text[]
        )`,
        families: sql<number>`(
          select count(*)::int from family_members fm where fm.user_id = "users"."id"
        )`,
        activeSessions: sql<number>`(
          select count(*)::int from sessions s
          where s."userId" = "users"."id" and s."expiresAt" > now()
        )`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(take)
      .offset(Math.max(offset, 0)),
    db.select({ n: count() }).from(users).where(where),
  ]);

  return { rows, total: totalRow[0]?.n ?? 0 };
}

/* -------------------------------------------------------------------------- */
/* Families                                                                    */
/* -------------------------------------------------------------------------- */

export interface AdminFamilyRow {
  id: string;
  name: string;
  ownerName: string | null;
  members: number;
  messages: number;
  places: number;
  createdAt: Date;
  lastMessageAt: Date | null;
}

/**
 * Families by size.
 *
 * `lastMessageAt` is a timestamp and nothing else — enough to tell a live
 * household from an abandoned one, which is the operational question, without
 * saying anything about what was said.
 */
export async function listFamilies({
  search,
  limit = 50,
  offset = 0,
}: { search?: string; limit?: number; offset?: number } = {}): Promise<{
  rows: AdminFamilyRow[];
  total: number;
}> {
  await requirePlatformAdmin();

  const take = Math.min(Math.max(limit, 1), 200);
  const term = search?.trim();
  const where = term ? ilike(families.name, `%${term}%`) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: families.id,
        name: families.name,
        ownerName: users.name,
        createdAt: families.createdAt,
        members: sql<number>`(
          select count(*)::int from family_members fm where fm.family_id = "families"."id"
        )`,
        messages: sql<number>`(
          select count(*)::int from messages m where m.family_id = "families"."id"
        )`,
        places: sql<number>`(
          select count(*)::int from places p where p.family_id = "families"."id"
        )`,
        /*
         * Typed as a string on purpose. Drizzle applies no type mapper to a
         * raw expression, so this arrives as Postgres wrote it and any
         * `Date | null` annotation here would simply be untrue — the value is
         * turned into a Date below, where it can actually be done.
         */
        lastMessageAt: sql<string | null>`(
          select max(m.created_at) from messages m where m.family_id = "families"."id"
        )`,
      })
      .from(families)
      .leftJoin(users, eq(users.id, families.ownerId))
      .where(where)
      .orderBy(desc(families.createdAt))
      .limit(take)
      .offset(Math.max(offset, 0)),
    db.select({ n: count() }).from(families).where(where),
  ]);

  return {
    rows: rows.map(({ lastMessageAt, ...rest }) => ({
      ...rest,
      lastMessageAt: lastMessageAt ? new Date(lastMessageAt) : null,
    })),
    total: totalRow[0]?.n ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Health                                                                      */
/* -------------------------------------------------------------------------- */

export interface DeploymentHealth {
  turn: 'ephemeral' | 'static' | 'none';
  blobStorage: boolean;
  googleAuth: boolean;
  push: boolean;
  email: boolean;
}

/**
 * Which optional pieces this deployment actually has.
 *
 * Every one of these has already been the cause of something appearing broken
 * with no way to tell from inside the app: voice notes silently refused
 * because no blob store was connected, calls failing on mobile data because no
 * relay was configured. Naming them on one screen is cheaper than diagnosing
 * them again.
 */
export async function deploymentHealth(): Promise<DeploymentHealth> {
  await requirePlatformAdmin();

  const { turnMode } = await import('@/lib/calls/turn');
  const { isAvatarUploadEnabled, isGoogleAuthEnabled } = await import('@/lib/env');

  return {
    turn: turnMode(),
    blobStorage: isAvatarUploadEnabled(),
    googleAuth: isGoogleAuthEnabled(),
    /*
     * Read straight from the environment, as the modules that use them do.
     * They are not in the validated schema, so asking it would report every
     * deployment as having neither.
     */
    push: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    email: Boolean(process.env.RESEND_API_KEY ?? process.env.SMTP_URL),
  };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Ends every session a person has, everywhere.
 *
 * The one destructive-ish thing offered here, and the mildest useful one: it
 * locks somebody out of a lost phone without touching their account or their
 * families. They sign in again and carry on.
 *
 * Deleting accounts is deliberately absent. A user is the hinge of families,
 * messages and emergencies, and removing one from an admin screen — where the
 * person doing it is furthest from understanding the consequences — is not a
 * button worth having.
 */
export async function revokeSessions(userId: string): Promise<number> {
  await requirePlatformAdmin();

  const removed = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });

  return removed.length;
}

/**
 * Grants or withdraws platform admin.
 *
 * Withdrawing your own is refused. It is the one move that cannot be undone
 * from inside the app — there would be nobody left able to reach this screen —
 * and recovering from it means going to the database.
 */
export async function setPlatformAdmin(userId: string, value: boolean): Promise<void> {
  const actor = await requirePlatformAdmin();

  if (actor.id === userId && !value) {
    throw Errors.badRequest(
      'You cannot remove your own admin access. Ask another admin, or change it in the database.',
    );
  }

  await db
    .update(users)
    .set({ isPlatformAdmin: value, updatedAt: new Date() })
    .where(eq(users.id, userId));
}


/** Guards against the last admin being demoted by a second admin. */
export async function countPlatformAdmins(): Promise<number> {
  await requirePlatformAdmin();

  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true)));

  return row?.n ?? 0;
}
