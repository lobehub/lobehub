import {
  findSiblingCreateGroupCallIds,
  GroupAgentBuilderApiName,
  GroupAgentBuilderIdentifier,
} from '@lobechat/builtin-tool-group-agent-builder';
import type { LobeChatDatabase } from '@lobechat/database';

import { MessageModel } from '@/database/models/message';

interface ResolveBuilderGroupIdParams {
  db: LobeChatDatabase;
  /** The group the run was opened on (`state.origin.editingGroupId`). */
  editingGroupId?: string;
  /** The branch the run is on; `null`/absent means the main conversation. */
  threadId?: string | null;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * The group a Group Agent Builder conversation is working on.
 *
 * A run is pinned to the group it was opened on, but `createGroup` can make a
 * new one mid-conversation — from then on "the group" means the new one, both
 * for the rest of this run and for later runs in the same topic. The run's
 * origin is frozen, so the switch is read back from the conversation itself:
 * the newest `createGroup` result on the run's branch wins over the pinned
 * group. Only that branch counts — a group created in a sibling thread must
 * not retarget this one.
 */
export const resolveBuilderGroupId = async ({
  db,
  editingGroupId,
  threadId,
  topicId,
  userId,
  workspaceId,
}: ResolveBuilderGroupIdParams): Promise<string | undefined> => {
  if (topicId) {
    const created = await new MessageModel(db, userId, workspaceId).findLatestPluginStateInTopic({
      apiName: GroupAgentBuilderApiName.createGroup,
      identifier: GroupAgentBuilderIdentifier,
      threadId: threadId ?? null,
      topicId,
    });
    if (typeof created?.groupId === 'string' && created.groupId) return created.groupId;
  }

  return editingGroupId;
};

interface AwaitingSiblingCreateGroupParams {
  /** The assistant message that issued this tool call (and its siblings). */
  assistantMessageId?: string;
  db: LobeChatDatabase;
  toolCallId?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Whether a `createGroup` issued in the same step as this call has not returned
 * a group yet.
 *
 * `createGroup` needs approval, so the runtime runs its siblings first — before
 * any group exists. Resolving "the group" then falls back to the pinned one and
 * a write meant for the new group lands on the old. Such a call has to be
 * refused rather than guessed at; once `createGroup` has produced its group the
 * normal resolution applies.
 */
export const isAwaitingSiblingCreateGroup = async ({
  assistantMessageId,
  db,
  toolCallId,
  userId,
  workspaceId,
}: AwaitingSiblingCreateGroupParams): Promise<boolean> => {
  if (!assistantMessageId) return false;

  const messageModel = new MessageModel(db, userId, workspaceId);
  const assistant = await messageModel.findById(assistantMessageId);
  const siblingIds = findSiblingCreateGroupCallIds(
    assistant?.tools as Parameters<typeof findSiblingCreateGroupCallIds>[0],
    toolCallId,
  );
  if (siblingIds.length === 0) return false;

  const createdGroupIds = await Promise.all(
    siblingIds.map(async (siblingId) => {
      const toolMessageId = await messageModel.findToolMessageIdByToolCallId(
        siblingId,
        assistantMessageId,
      );
      const plugin = toolMessageId
        ? await messageModel.findMessagePlugin(toolMessageId)
        : undefined;
      return plugin?.state?.groupId;
    }),
  );

  return createdGroupIds.some((groupId) => typeof groupId !== 'string' || !groupId);
};
