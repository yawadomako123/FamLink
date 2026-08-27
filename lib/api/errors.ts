/**
 * API error taxonomy.
 *
 * A deliberate rule runs through this file: FamLink never distinguishes
 * "this family/place/message does not exist" from "it exists but is not
 * yours". Both produce 404. Returning 403 for the second case would turn every
 * endpoint into an oracle for probing which family ids are real.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  unauthorized: () =>
    new ApiError(401, 'UNAUTHORIZED', 'You need to be signed in to do that.'),

  /** Authenticated, but lacks the required role within a family they belong to. */
  forbidden: (message = "You don't have permission to do that.") =>
    new ApiError(403, 'FORBIDDEN', message),

  /** Also used when a resource exists but the caller has no claim to it. */
  notFound: (what = 'That') => new ApiError(404, 'NOT_FOUND', `${what} could not be found.`),

  badRequest: (message: string, details?: unknown) =>
    new ApiError(400, 'BAD_REQUEST', message, details),

  conflict: (message: string) => new ApiError(409, 'CONFLICT', message),

  validation: (details: unknown) =>
    new ApiError(422, 'VALIDATION_FAILED', 'Some of those details need fixing.', details),

  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', {
      retryAfterSeconds,
    }),

  internal: () =>
    new ApiError(500, 'INTERNAL', 'Something went wrong on our end. Please try again.'),
} as const;

/* -------------------------------------------------------------------------- */
/* Domain-specific errors with user-facing copy                                */
/* -------------------------------------------------------------------------- */

export const DomainErrors = {
  invitationExpired: () =>
    new ApiError(410, 'INVITATION_EXPIRED', 'This invitation has expired.'),

  invitationUsed: () =>
    new ApiError(410, 'INVITATION_USED', 'This invitation has already been used.'),

  invitationRevoked: () =>
    new ApiError(410, 'INVITATION_REVOKED', 'This invitation is no longer valid.'),

  alreadyMember: () =>
    new ApiError(409, 'ALREADY_MEMBER', "You're already a member of this family."),

  notAMember: () =>
    new ApiError(403, 'NOT_A_MEMBER', 'You are no longer a member of this family.'),

  ownerCannotLeave: () =>
    new ApiError(
      409,
      'OWNER_CANNOT_LEAVE',
      'Transfer ownership to another member before leaving this family.',
    ),

  cannotRemoveOwner: () =>
    new ApiError(409, 'CANNOT_REMOVE_OWNER', 'The family owner cannot be removed.'),

  locationNotShared: () =>
    new ApiError(403, 'LOCATION_NOT_SHARED', 'This member is not sharing their location.'),
} as const;
