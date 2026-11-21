import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';

/** Slugs owned by builtin provisioning; a group delete must never reach one. */
export const RESERVED_BUILTIN_AGENT_SLUGS: string[] = Object.values(BUILTIN_AGENT_SLUGS);

/**
 * The group is no longer where the transfer request said it was: moved scope,
 * changed hands, or was deleted. The request that referenced it can never
 * complete.
 */
export const CHAT_GROUP_OWNERSHIP_STALE = 'CHAT_GROUP_OWNERSHIP_STALE';

/**
 * Handover refused: the group references a member agent that is private to
 * someone other than the recipient, who would silently lose that participant.
 */
export const CHAT_GROUP_TRANSFER_HIDDEN_MEMBER = 'CHAT_GROUP_TRANSFER_HIDDEN_MEMBER';
