/**
 * Number of days a workspace invitation token stays valid before it expires.
 * Shared by `WorkspaceMemberModel.createInvitation` (sets `expiresAt`) and the
 * cloud invite-email template (renders the human-facing expiry copy), so the
 * actual TTL and what we promise to recipients can't drift apart.
 *
 * If you change this, also update the "expire after 1 week" copy in
 * `lobehub/src/locales/default/setting.ts` (`workspace.members.invite.modal.expiryWarning`).
 */
export const INVITATION_EXPIRY_DAYS = 7;

/**
 * Most members that one "add collaborators" call may grant at a time. Shared
 * by the `addCollaborators` procedure (rejects longer arrays) and the member
 * picker (stops selecting past it), so the UI can never assemble a selection
 * the server is going to refuse wholesale.
 */
export const MAX_RESOURCE_COLLABORATORS_PER_ADD = 100;

/**
 * Format rules for a workspace slug: length bounds plus lowercase
 * alphanumerics with inner hyphens. Generic on purpose — they define what a
 * slug *is*, so the OSS workspace router contract and the CLI validate the
 * same shape a business deployment does. Deployment-specific refusals (slugs
 * that would shadow a real top-level route, protected brand names) are a
 * business concern layered on top of these and do not live here.
 */
export const WORKSPACE_SLUG_MIN = 3;
export const WORKSPACE_SLUG_MAX = 32;
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Format-only check against {@link WORKSPACE_SLUG_PATTERN}; no length check. */
export const isWorkspaceSlugFormatValid = (slug: string): boolean =>
  WORKSPACE_SLUG_PATTERN.test(slug);
