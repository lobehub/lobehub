import type { ChatTopicBotContext } from '@lobechat/types';

export interface BuildBotContextParams {
  applicationId: string;
  /** Platform-assigned ID of the inbound message author (e.g. Discord/Slack `user.id`). */
  authorUserId: string | undefined;
  /**
   * Configured owner ID for this bot install (e.g. `agent_bot_providers.settings.userId`
   * or messenger link's `platformUserId`). Owner identity is decided by
   * exact equality with `authorUserId` — never inferred, never defaulted.
   */
  operatorUserId: string | undefined;
  platform: string;
  platformThreadId: string;
}

/**
 * Build the per-turn `ChatTopicBotContext` for an inbound bot message.
 *
 * This helper is the **single** place that decides `isOwner`. Downstream
 * policy (`resolveDeviceAccessPolicy`, audit log, agent runtime gates) reads
 * `isOwner` directly and never recomputes — keeping the rule one-place-only
 * is what prevents the fail-closed default from regressing as new routers
 * (Bot, Messenger, future platforms) are added.
 *
 * Fail-closed contract: when `operatorUserId` is missing the result is
 * `isOwner: false`, regardless of `authorUserId`. Treating absent owner
 * configuration as "trusted" would silently grant device access to every
 * sender on unconfigured installs.
 */
export const buildBotContext = (params: BuildBotContextParams): ChatTopicBotContext => {
  const senderExternalUserId = params.authorUserId ?? '';
  const isOwner = !!params.operatorUserId && senderExternalUserId === params.operatorUserId;
  return {
    applicationId: params.applicationId,
    isOwner,
    platform: params.platform,
    platformThreadId: params.platformThreadId,
    senderExternalUserId,
  };
};
