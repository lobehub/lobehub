import {
  GroupAgentBuilderApiName,
  GroupAgentBuilderIdentifier,
} from '@lobechat/builtin-tool-group-agent-builder';
import type { LobeChatDatabase } from '@lobechat/database';

import { MessageModel } from '@/database/models/message';

interface ResolveBuilderGroupIdParams {
  db: LobeChatDatabase;
  /** The group the run was opened on (`state.origin.editingGroupId`). */
  editingGroupId?: string;
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
 * the newest `createGroup` result recorded in the topic wins over the pinned
 * group.
 */
export const resolveBuilderGroupId = async ({
  db,
  editingGroupId,
  topicId,
  userId,
  workspaceId,
}: ResolveBuilderGroupIdParams): Promise<string | undefined> => {
  if (topicId) {
    const created = await new MessageModel(db, userId, workspaceId).findLatestPluginStateInTopic({
      apiName: GroupAgentBuilderApiName.createGroup,
      identifier: GroupAgentBuilderIdentifier,
      topicId,
    });
    if (typeof created?.groupId === 'string' && created.groupId) return created.groupId;
  }

  return editingGroupId;
};
