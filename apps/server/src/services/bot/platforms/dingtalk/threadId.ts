import { DINGTALK_THREAD_PREFIX } from './const';

export type DingTalkConversationType = 'single' | 'group';

export interface DingTalkConversation {
  /** `senderStaffId` (or `senderId` for external contacts) for single chats, `openConversationId` for groups. */
  id: string;
  type: DingTalkConversationType;
}

/**
 * Decode `dingtalk:<single|group>:<id>` — the thread id the adapter encodes.
 *
 * Only the first two separators are structural: DingTalk's encrypted
 * `senderId` (`$:LWCP_v1:$…`) contains `:` itself, so the rest is kept whole.
 * Anything that is not a DingTalk thread id is treated as a bare group
 * conversation id, matching the adapter's `decodeThreadId`.
 */
export const parseDingTalkThreadId = (platformThreadId: string): DingTalkConversation => {
  const [prefix, type, ...rest] = platformThreadId.split(':');
  if (
    prefix !== DINGTALK_THREAD_PREFIX ||
    (type !== 'single' && type !== 'group') ||
    rest.length === 0
  ) {
    return { id: platformThreadId, type: 'group' };
  }
  return { id: rest.join(':'), type };
};

export const formatDingTalkThreadId = ({ id, type }: DingTalkConversation): string =>
  `${DINGTALK_THREAD_PREFIX}:${type}:${id}`;

/**
 * Accept the forms a model may hand the `lobe-message` tool as `channelId`:
 * the full thread id (`dingtalk:group:cid…`), a typed id (`single:staff1`,
 * `group:cid…`), or a bare id, which is taken as a group conversation because
 * every `openConversationId` the bot sees comes from a group.
 */
export const parseDingTalkChannelId = (channelId: string): DingTalkConversation => {
  if (channelId.startsWith(`${DINGTALK_THREAD_PREFIX}:`)) return parseDingTalkThreadId(channelId);

  const [type, ...rest] = channelId.split(':');
  if ((type === 'single' || type === 'group') && rest.length > 0) {
    return { id: rest.join(':'), type };
  }
  return { id: channelId, type: 'group' };
};
