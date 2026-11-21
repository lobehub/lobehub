import { agents, chatGroups, chatGroupsAgents, messages, threads, topics } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

/**
 * The caller scope an `AgentGroupRepository` runs in, shared with the
 * copy / transfer modules so they apply the same ownership predicates.
 */
export class AgentGroupScope {
  readonly db: LobeChatDatabase;
  readonly userId: string;
  readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  /**
   * Workspace-aware ownership predicate for the `chat_groups` table. In personal
   * mode (`workspaceId` absent) matches `user_id = ? AND workspace_id IS NULL`;
   * in team mode matches `workspace_id = ?` (shared with all members).
   */
  groupOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroups);
  agentOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents);
  groupAgentOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, chatGroupsAgents);
  topicOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, topics);
  threadOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads);
  messageOwnership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, messages);
}
