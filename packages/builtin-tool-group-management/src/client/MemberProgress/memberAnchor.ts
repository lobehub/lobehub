import { getGroupMemberAnchorIndex, ThreadStatus, type UIChatMessage } from '@lobechat/types';

interface MemberAnchorState {
  status?: string;
  threadId?: string;
}

const anchorState = (anchor: UIChatMessage) => anchor.pluginState as MemberAnchorState | undefined;

/**
 * Member anchors under the group tool call `toolCallId`, keyed by task index.
 * Only server-run multi-member calls write anchors; a client-run call has none.
 */
export const selectMemberAnchors = (
  messages: UIChatMessage[],
  toolCallId: string | undefined,
): Record<number, UIChatMessage> => {
  const anchors: Record<number, UIChatMessage> = {};
  if (!toolCallId) return anchors;

  const groupTool = messages.find((m) => m.role === 'tool' && m.tool_call_id === toolCallId);
  if (!groupTool) return anchors;

  for (const message of messages) {
    if (message.parentId !== groupTool.id) continue;
    const index = getGroupMemberAnchorIndex(message, 'tool');
    if (index !== undefined) anchors[index] = message;
  }
  return anchors;
};

/**
 * The server's backfill on the anchor is final. Until it lands, the polled
 * thread status (`taskDetail`) is the live progress; an anchor with neither has
 * just started.
 */
export const resolveMemberStatus = (anchor: UIChatMessage): ThreadStatus => {
  const status = anchorState(anchor)?.status;
  if (status === 'completed') return ThreadStatus.Completed;
  if (status === 'error') return ThreadStatus.Failed;
  return anchor.taskDetail?.status ?? ThreadStatus.Processing;
};

/** The member's isolation thread, once polled or backfilled onto the anchor. */
export const resolveMemberThreadId = (anchor: UIChatMessage): string | undefined =>
  anchor.taskDetail?.threadId ?? anchorState(anchor)?.threadId;

/**
 * Whether the group card shows the call's own result. A server run shows each
 * member's answer under its task, and its group result repeats those answers
 * for the supervisor, so the block only shows for a client run (no anchors) or
 * when a hook replaced the result with its own reason.
 */
export const shouldShowGroupResult = (
  content: string,
  anchors: Record<number, UIChatMessage>,
  pluginState?: unknown,
): boolean =>
  !!content &&
  (Object.keys(anchors).length === 0 ||
    (pluginState as { type?: string } | undefined)?.type === 'blocked');
