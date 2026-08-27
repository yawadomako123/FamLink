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
     * Short, human-shareable code that appears in the join URL (…/join/ABC123).
     * Generated from a CSPRNG over an unambiguous alphabet.
     */
    code: text('code').notNull().unique(),
    /**
     * SHA-256 of the code. Lookups hash the incoming code and compare against
     * this, so a database leak does not hand out working invitations.
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

export type FamilyRole = (typeof familyRole.enumValues)[number];
export type LocationSharingState = (typeof locationSharingState.enumValues)[number];
export type LocationVisibility = (typeof locationVisibility.enumValues)[number];
export type NotificationType = (typeof notificationType.enumValues)[number];
