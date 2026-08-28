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
