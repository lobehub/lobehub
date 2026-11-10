export const PROJECT_IDENTIFIER_REGEX = /^[A-Z][A-Z0-9]{2,5}$/;

/**
 * `CONFLICT` messages for a taken project slug or identifier.
 *
 * The create router sends one of these as the tRPC error message, so a form can
 * tell which field the conflict belongs to and mark that input instead of
 * showing a generic failure.
 */
export const PROJECT_DUPLICATE_IDENTIFIER = 'DUPLICATE_PROJECT_IDENTIFIER';

export const PROJECT_DUPLICATE_SLUG = 'DUPLICATE_PROJECT_SLUG';

/** The field a person edits to resolve a duplicate project value. */
export type ProjectDuplicateField = 'identifier' | 'slug';

export const PROJECT_STATUSES = [
  'backlog',
  'active',
  'paused',
  'reviewing',
  'completed',
  'canceled',
  'archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_VISIBILITIES = ['private', 'public'] as const;

export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

export const PROJECT_WORKING_DIRECTORY_PERMISSIONS = ['readOnly', 'readWrite'] as const;

export type ProjectWorkingDirectoryPermission =
  (typeof PROJECT_WORKING_DIRECTORY_PERMISSIONS)[number];

export const PROJECT_COMPLETION_DECISIONS = ['accepted', 'rejected'] as const;

export type ProjectCompletionDecision = (typeof PROJECT_COMPLETION_DECISIONS)[number];

export const PROJECT_MEMBER_ROLES = ['viewer', 'member', 'admin'] as const;

export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];
