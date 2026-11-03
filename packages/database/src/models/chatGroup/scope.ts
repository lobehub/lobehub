import { chatGroups, chatGroupsAgents } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { ChatGroupModel } from './index';

/** The caller identity every `ChatGroupModel` query is scoped by. */
export interface ChatGroupContext {
  db: LobeChatDatabase;
  /**
   * The model instance itself. A module function that builds on a public read calls it through
   * here, so the call still dispatches through the instance as `this.<method>` did.
   */
  model: Pick<ChatGroupModel, 'findById' | 'getGroupAgents'>;
  userId: string;
  workspaceId?: string;
}

/** The chat groups the caller may see: their own, or the workspace's visible ones. */
export const groupOwnership = (ctx: ChatGroupContext) =>
  buildWorkspaceWhere(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    {
      isDeleted: chatGroups.isDeleted,
      userId: chatGroups.userId,
      workspaceId: chatGroups.workspaceId,
      visibility: chatGroups.visibility,
    },
  );

/** The membership rows in the caller's scope. */
export const groupAgentsOwnership = (ctx: ChatGroupContext) =>
  buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, chatGroupsAgents);
