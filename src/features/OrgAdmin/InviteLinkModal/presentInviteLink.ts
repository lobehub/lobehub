import { createInviteLinkModal } from './createInviteLinkModal';

/**
 * Surfaces the one-shot invite URL returned by `organization.inviteMember`
 * so the manager can copy/share it (messenger, etc.). List endpoints never
 * re-expose the token — this is the only recovery path after create.
 */
export const presentInviteLink = (inviteUrl: string) => {
  if (!inviteUrl) return;
  createInviteLinkModal({ inviteUrl });
};
