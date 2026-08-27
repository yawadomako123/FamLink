/**
 * FamLink database schema.
 *
 * Two naming conventions coexist here, deliberately:
 *
 *  - The authentication tables (`users`, `sessions`, `accounts`,
 *    `verifications`) use camelCase columns because Better Auth's Drizzle
 *    adapter addresses them by its own field names. Renaming them would mean
 *    maintaining a field map, which is a needless source of drift.
 *  - Every FamLink domain table uses snake_case, the Postgres convention.
 *
 * Location tables are split on purpose: `locations` is the append-only history,
 * `current_locations` holds exactly one row per member per family and is the
 * only table the live map reads. See lib/db/README notes in the project README.
 */
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* ========================================================================== */
/* Enums                                                                       */
/* ========================================================================== */

export const familyRole = pgEnum('family_role', ['owner', 'admin', 'member']);

export const locationSharingState = pgEnum('location_sharing_state', [
  'off',
  'sharing',
  'paused',
]);

/**
 * `selected` is present from day one so that adding per-member location
 * sharing later is a feature flag rather than a data migration. The MVP only
 * ever writes `everyone` or `nobody`; `location_shares` below is its table.
 */
export const locationVisibility = pgEnum('location_visibility', [
  'everyone',
  'selected',
  'nobody',
]);

export const notificationType = pgEnum('notification_type', [
  'LOCATION_ENABLED',
  'LOCATION_DISABLED',
  'ARRIVED_PLACE',
  'LEFT_PLACE',
  'FAMILY_INVITE',
  'SOS',
]);

export const placeEventType = pgEnum('place_event_type', ['arrived', 'left']);

export const emergencyStatus = pgEnum('emergency_status', ['active', 'resolved', 'cancelled']);

export const callKind = pgEnum('call_kind', ['audio', 'video']);

export const callStatus = pgEnum('call_status', [
  'ringing',
  'active',
  'ended',
  'missed',
  'declined',
]);

export const checkInStatus = pgEnum('check_in_status', ['pending', 'answered', 'expired']);

/** How a member answered a check-in. Coarse on purpose — not a mood tracker. */
export const checkInReply = pgEnum('check_in_reply', ['ok', 'need_help']);

/* ========================================================================== */
/* Authentication (Better Auth owns the shape of these four tables)            */
/* ========================================================================== */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified')
    .notNull()
    .default(sql`false`),
  image: text('image'),
  createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    /** Required by Better Auth; 'credential' for email/password accounts. */
    issuer: text('issuer').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
    scope: text('scope'),
    /** Better Auth stores the password hash here; FamLink never touches it. */
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

/* ========================================================================== */
/* Families                                                                    */
/* ========================================================================== */

export const families = pgTable(
  'families',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('families_owner_idx').on(t.ownerId)],
);

export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: familyRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),

    /*
     * Location privacy lives on the membership, not on the user, so somebody
     * can share with their household while staying invisible to another
     * family they belong to.
     */
    locationSharingState: locationSharingState('location_sharing_state')
      .notNull()
      .default('off'),
    locationVisibility: locationVisibility('location_visibility').notNull().default('everyone'),

    /*
     * Device telemetry. Battery is optional everywhere in the product — the
     * Battery Status API is unavailable in Safari and Firefox — and these
     * columns exist mainly so a future native client can populate them.
     */
    batteryPercentage: smallint('battery_percentage'),
    isCharging: boolean('is_charging'),
    batteryUpdatedAt: timestamp('battery_updated_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),

    /**
     * Timed sharing. When set, sharing reverts to `off` once this passes —
     * enforced on read as well as by a sweep, so an expired window cannot
     * leak a position merely because no cleanup has run yet.
     */
    sharingExpiresAt: timestamp('sharing_expires_at', { withTimezone: true }),

    /**
     * Suppresses repeat low-battery alerts. Without it, every location update
     * from a phone sitting on 12% would notify the whole family again.
     */
    batteryAlertedAt: timestamp('battery_alerted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('family_members_family_user_key').on(t.familyId, t.userId),
    index('family_members_user_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    /**
     * SHA-256 of the invitation code, which is the only thing stored.
     *
     * The plaintext code is returned exactly once, when the invitation is
     * created, and is never recoverable afterwards — the same discipline as an
     * API key. Storing it alongside the hash would make the hash decorative,
     * since a database leak would then hand out working invitations. Losing a
     * link means revoking it and issuing another.
     */
    codeHash: text('code_hash').notNull(),
    role: familyRole('role').notNull().default('member'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invitations_family_idx').on(t.familyId),
    uniqueIndex('invitations_code_hash_key').on(t.codeHash),
  ],
);

/**
 * Reserved for the future "selected family members" visibility mode. Empty in
 * the MVP; present so the feature ships without touching existing rows.
 */
export const locationShares = pgTable(
  'location_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    /** Whose location is being shared. */
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who is allowed to see it. */
    viewerId: text('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('location_shares_unique').on(t.familyId, t.ownerId, t.viewerId),
    index('location_shares_viewer_idx').on(t.familyId, t.viewerId),
  ],
);

/* ========================================================================== */
/* Location                                                                    */
/* ========================================================================== */

/** Append-only history. Never read by the map. */
export const locations = pgTable(
  'locations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    /** Radius of 68% confidence in metres, as reported by the device. */
    accuracy: doublePrecision('accuracy'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Drives the "my history" timeline.
    index('locations_user_recorded_idx').on(t.userId, t.recordedAt.desc()),
    index('locations_family_recorded_idx').on(t.familyId, t.recordedAt.desc()),
  ],
);

/** Exactly one row per member per family — the live map's only source. */
export const currentLocations = pgTable(
  'current_locations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    accuracy: doublePrecision('accuracy'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.familyId] }),
    index('current_locations_family_idx').on(t.familyId),
  ],
);

/* ========================================================================== */
/* Places and geofencing                                                       */
/* ========================================================================== */

export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Free-text locality shown under the name, e.g. "Accra". */
    address: text('address'),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    /** Geofence radius in metres. */
    radius: integer('radius').notNull().default(200),
    /** Icon key resolved client-side; keeps the enum out of the database. */
    icon: text('icon').notNull().default('pin'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('places_family_idx').on(t.familyId)],
);

/**
 * Tracks whether a member is currently inside each place, so a geofence
 * transition can be detected from one location update to the next. Without
 * this we would emit "arrived" on every single ping inside the radius.
 */
export const memberPlaceStates = pgTable(
  'member_place_states',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    isInside: boolean('is_inside').notNull(),
    since: timestamp('since', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.placeId] })],
);

export const placeEvents = pgTable(
  'place_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    type: placeEventType('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('place_events_family_occurred_idx').on(t.familyId, t.occurredAt.desc())],
);

/* ========================================================================== */
/* Notifications and emergencies                                               */
/* ========================================================================== */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Recipient. One row per recipient, never one row fanned out. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    /** Type-specific payload (place id, emergency id, …). Never coordinates. */
    data: jsonb('data').$type<Record<string, unknown>>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt.desc()),
    // Powers the unread badge without scanning the user's whole history.
    // Postgres rejects table-qualified names in an index predicate, so the
    // column is referenced bare here rather than through the column object.
    index('notifications_user_unread_idx')
      .on(t.userId)
      .where(sql`read_at is null`),
  ],
);

export const emergencyEvents = pgTable(
  'emergency_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Nullable: an SOS must still send if we cannot get a fix in time. */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    accuracy: doublePrecision('accuracy'),
    status: emergencyStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('emergency_events_family_created_idx').on(t.familyId, t.createdAt.desc()),
    index('emergency_events_active_idx')
      .on(t.familyId)
      .where(sql`status = 'active'`),
  ],
);

/* ========================================================================== */
/* Chat                                                                        */
/* ========================================================================== */

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    /** Soft delete, so a removed message leaves the thread order intact. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_family_created_idx').on(t.familyId, t.createdAt.desc())],
);

/** High-water mark per member; unread count is a range count against it. */
export const messageReads = pgTable(
  'message_reads',
  {
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.familyId, t.userId] })],
);

/* ========================================================================== */
/* Notification preferences                                                    */
/* ========================================================================== */

/**
 * Per member, per family.
 *
 * An absent row means "everything on", so a member never misses an alert
 * because a preferences row was not created for them.
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),

    arrivals: boolean('arrivals').notNull().default(true),
    departures: boolean('departures').notNull().default(true),
    sharingChanges: boolean('sharing_changes').notNull().default(true),
    lowBattery: boolean('low_battery').notNull().default(true),
    chatMessages: boolean('chat_messages').notNull().default(true),
    checkIns: boolean('check_ins').notNull().default(true),

    /*
     * SOS is deliberately absent, and must stay absent. An emergency alert is
     * the one thing nobody may opt out of receiving — a family where somebody
     * has muted the SOS is not a safety net. Quiet hours do not silence it
     * either.
     */

    /** Quiet hours as minutes past local midnight. Null disables them. */
    quietHoursStart: smallint('quiet_hours_start'),
    quietHoursEnd: smallint('quiet_hours_end'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.familyId] })],
);

/* ========================================================================== */
/* Calls                                                                       */
/* ========================================================================== */

/**
 * A call session.
 *
 * Media never touches the server — WebRTC carries audio and video peer to
 * peer — so these rows are purely coordination: who is ringing whom, and who
 * joined.
 */
export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    initiatorId: text('initiator_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: callKind('kind').notNull(),
    status: callStatus('status').notNull().default('ringing'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('calls_family_started_idx').on(t.familyId, t.startedAt.desc()),
    index('calls_live_idx')
      .on(t.familyId)
      .where(sql`status in ('ringing', 'active')`),
  ],
);

export const callParticipants = pgTable(
  'call_participants',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.callId, t.userId] })],
);

/**
 * WebRTC signalling: offers, answers and ICE candidates.
 *
 * Persisted rather than held in memory because serverless instances share no
 * state — a peer's answer may reach a different instance than the one that
 * handled the offer. Rows are short-lived and swept when a call ends.
 */
export const callSignals = pgTable(
  'call_signals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Null addresses every other participant. */
    toUserId: text('to_user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('call_signals_delivery_idx').on(t.callId, t.toUserId, t.id)],
);

/* ========================================================================== */
/* Check-ins                                                                   */
/* ========================================================================== */

/**
 * "Are you OK?" — asked of a person, answered in one tap.
 *
 * Deliberately not a location request. It asks somebody a question; their
 * sharing settings are untouched by it, and attaching a position to the reply
 * is their choice.
 */
export const checkInRequests = pgTable(
  'check_in_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    note: text('note'),
    status: checkInStatus('status').notNull().default('pending'),
    reply: checkInReply('reply'),
    /**
     * Optional one-off disclosure attached to a reply. Never changes the
     * responder's standing sharing setting.
     */
    replyLatitude: doublePrecision('reply_latitude'),
    replyLongitude: doublePrecision('reply_longitude'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('check_ins_target_idx').on(t.targetId, t.createdAt.desc()),
    index('check_ins_family_idx').on(t.familyId, t.createdAt.desc()),
  ],
);

/* ========================================================================== */
/* Message reactions                                                           */
/* ========================================================================== */

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** A single emoji, validated at the boundary. */
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One reaction per person per message; a second replaces the first.
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);

/* ========================================================================== */
/* Push Subscriptions                                                          */
/* ========================================================================== */

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
);

/* ========================================================================== */
/* Relations                                                                   */
/* ========================================================================== */

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(familyMembers),
  ownedFamilies: many(families),
}));

export const familiesRelations = relations(families, ({ one, many }) => ({
  owner: one(users, { fields: [families.ownerId], references: [users.id] }),
  members: many(familyMembers),
  places: many(places),
  messages: many(messages),
}));

export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  family: one(families, { fields: [familyMembers.familyId], references: [families.id] }),
  user: one(users, { fields: [familyMembers.userId], references: [users.id] }),
}));

export const currentLocationsRelations = relations(currentLocations, ({ one }) => ({
  user: one(users, { fields: [currentLocations.userId], references: [users.id] }),
  family: one(families, { fields: [currentLocations.familyId], references: [families.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  family: one(families, { fields: [messages.familyId], references: [families.id] }),
}));

export const placeEventsRelations = relations(placeEvents, ({ one }) => ({
  place: one(places, { fields: [placeEvents.placeId], references: [places.id] }),
  user: one(users, { fields: [placeEvents.userId], references: [users.id] }),
}));

/* ========================================================================== */
/* Inferred types                                                              */
/* ========================================================================== */

export type User = typeof users.$inferSelect;
export type Family = typeof families.$inferSelect;
export type FamilyMember = typeof familyMembers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type LocationRow = typeof locations.$inferSelect;
export type CurrentLocation = typeof currentLocations.$inferSelect;
export type Place = typeof places.$inferSelect;
export type PlaceEvent = typeof placeEvents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type EmergencyEvent = typeof emergencyEvents.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type CallSignal = typeof callSignals.$inferSelect;
export type CheckInRequest = typeof checkInRequests.$inferSelect;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export type CallKind = (typeof callKind.enumValues)[number];
export type CallStatus = (typeof callStatus.enumValues)[number];
export type CheckInReplyValue = (typeof checkInReply.enumValues)[number];

export type FamilyRole = (typeof familyRole.enumValues)[number];
export type LocationSharingState = (typeof locationSharingState.enumValues)[number];
export type LocationVisibility = (typeof locationVisibility.enumValues)[number];
export type NotificationType = (typeof notificationType.enumValues)[number];
