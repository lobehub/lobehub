import type {
  TaskDetailActivity,
  TaskDetailActivityAuthor,
  TaskDetailData,
  TaskDetailSubtask,
  TaskDetailWorkspaceNode,
  TaskTopicHandoff,
  WorkspaceData,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const emptyWorkspace: WorkspaceData = { nodeMap: {}, tree: [] };

export class TaskService {
  private agentModel: AgentModel;
  private briefModel: BriefModel;
  private db: LobeChatDatabase;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.agentModel = new AgentModel(db, userId);
    this.taskModel = new TaskModel(db, userId);
    this.taskTopicModel = new TaskTopicModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
  }

  async getTaskDetail(taskIdOrIdentifier: string): Promise<TaskDetailData | null> {
    const task = await this.taskModel.resolve(taskIdOrIdentifier);
    if (!task) return null;

    const [allDescendants, dependencies, topics, briefs, comments, workspace] = await Promise.all([
      this.taskModel.findAllDescendants(task.id),
      this.taskModel.getDependencies(task.id),
      this.taskTopicModel.findWithHandoff(task.id).catch(() => []),
      this.briefModel.findByTaskId(task.id).catch(() => []),
      this.taskModel.getComments(task.id).catch(() => []),
      this.taskModel.getTreePinnedDocuments(task.id).catch(() => emptyWorkspace),
    ]);

    // Build dependency map for all descendants
    const allDescendantIds = allDescendants.map((s) => s.id);
    const allDescendantDeps =
      allDescendantIds.length > 0
        ? await this.taskModel.getDependenciesByTaskIds(allDescendantIds).catch(() => [])
        : [];
    const idToIdentifier = new Map(allDescendants.map((s) => [s.id, s.identifier]));
    const depMap = new Map<string, string>();
    for (const dep of allDescendantDeps) {
      const depId = idToIdentifier.get(dep.dependsOnId);
      if (depId) depMap.set(dep.taskId, depId);
    }

    // Build nested subtask tree
    const childrenMap = new Map<string, typeof allDescendants>();
    for (const t of allDescendants) {
      const parentId = t.parentTaskId!;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(t);
    }

    const buildSubtaskTree = (parentId: string): TaskDetailSubtask[] | undefined => {
      const children = childrenMap.get(parentId);
      if (!children || children.length === 0) return undefined;
      return children.map((s) => ({
        blockedBy: depMap.get(s.id),
        children: buildSubtaskTree(s.id),
        identifier: s.identifier,
        name: s.name,
        priority: s.priority,
        status: s.status,
      }));
    };

    // Root level: always return array (empty [] when no subtasks) for consistent API shape
    const subtasks = buildSubtaskTree(task.id) ?? [];

    // Resolve dependency task identifiers
    const depTaskIds = [...new Set(dependencies.map((d) => d.dependsOnId))];
    const depTasks = await this.taskModel.findByIds(depTaskIds);
    const depIdToInfo = new Map(
      depTasks.map((t) => [t.id, { identifier: t.identifier, name: t.name }]),
    );

    // Resolve parent
    let parent: { identifier: string; name: string | null } | null = null;
    if (task.parentTaskId) {
      const parentTask = await this.taskModel.findById(task.parentTaskId);
      if (parentTask) {
        parent = { identifier: parentTask.identifier, name: parentTask.name };
      }
    }

    // Build workspace tree (recursive)
    const buildWorkspaceNodes = (treeNodes: typeof workspace.tree): TaskDetailWorkspaceNode[] =>
      treeNodes.map((node) => {
        const doc = workspace.nodeMap[node.id];
        return {
          children: node.children.length > 0 ? buildWorkspaceNodes(node.children) : undefined,
          createdAt: doc?.createdAt ? new Date(doc.createdAt).toISOString() : undefined,
          documentId: node.id,
          fileType: doc?.fileType,
          size: doc?.charCount,
          sourceTaskIdentifier: doc?.sourceTaskIdentifier,
          title: doc?.title,
        };
      });

    const workspaceFolders = buildWorkspaceNodes(workspace.tree);

    // Build activities (merged & sorted desc by time)
    const toISO = (d: Date | string | null | undefined) =>
      d ? new Date(d).toISOString() : undefined;

    // Collect unique agent/user IDs for author resolution
    const agentIds = new Set<string>();
    const userIds = new Set<string>();

    // Topics are created by the task's assignee agent
    if (task.assigneeAgentId && topics.length > 0) agentIds.add(task.assigneeAgentId);
    // Briefs may have an agentId
    for (const b of briefs) {
      if (b.agentId) agentIds.add(b.agentId);
    }
    // Comments have authorAgentId or authorUserId
    for (const c of comments) {
      if (c.authorAgentId) agentIds.add(c.authorAgentId);
      if (c.authorUserId) userIds.add(c.authorUserId);
    }

    const authorMap = await this.resolveAuthors(agentIds, userIds);

    const activities: TaskDetailActivity[] = [
      ...topics.map((t) => ({
        author: task.assigneeAgentId ? authorMap.get(task.assigneeAgentId) : undefined,
        id: t.topicId ?? undefined,
        seq: t.seq,
        status: t.status,
        time: toISO(t.createdAt),
        title: (t.handoff as TaskTopicHandoff | null)?.title || 'Untitled',
        type: 'topic' as const,
      })),
      ...briefs.map((b) => ({
        author: b.agentId ? authorMap.get(b.agentId) : undefined,
        briefType: b.type,
        id: b.id,
        priority: b.priority,
        resolvedAction: b.resolvedAction
          ? b.resolvedComment
            ? `${b.resolvedAction}: ${b.resolvedComment}`
            : b.resolvedAction
          : undefined,
        summary: b.summary,
        time: toISO(b.createdAt),
        title: b.title,
        type: 'brief' as const,
      })),
      ...comments.map((c) => ({
        agentId: c.authorAgentId,
        author: c.authorAgentId
          ? authorMap.get(c.authorAgentId)
          : c.authorUserId
            ? authorMap.get(c.authorUserId)
            : undefined,
        content: c.content,
        time: toISO(c.createdAt),
        type: 'comment' as const,
      })),
    ].sort((a, b) => {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

    return {
      agentId: task.assigneeAgentId,
      checkpoint: this.taskModel.getCheckpointConfig(task),
      config: task.config ? (task.config as Record<string, unknown>) : undefined,
      createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : undefined,
      dependencies: dependencies.map((d) => {
        const info = depIdToInfo.get(d.dependsOnId);
        return {
          dependsOn: info?.identifier ?? d.dependsOnId,
          name: info?.name,
          type: d.type,
        };
      }),
      description: task.description,
      error: task.error,
      heartbeat:
        task.heartbeatTimeout || task.lastHeartbeatAt
          ? {
              interval: task.heartbeatInterval,
              lastAt: task.lastHeartbeatAt ? new Date(task.lastHeartbeatAt).toISOString() : null,
              timeout: task.heartbeatTimeout,
            }
          : undefined,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
      parent,
      priority: task.priority,
      review: this.taskModel.getReviewConfig(task),
      status: task.status,
      userId: task.assigneeUserId,
      subtasks,
      activities: activities.length > 0 ? activities : undefined,
      topicCount: topics.length > 0 ? topics.length : undefined,
      workspace: workspaceFolders.length > 0 ? workspaceFolders : undefined,
    };
  }

  /**
   * Batch-resolve agent and user IDs to author info (name + avatar).
   */
  private async resolveAuthors(
    agentIds: Set<string>,
    userIds: Set<string>,
  ): Promise<Map<string, TaskDetailActivityAuthor>> {
    const map = new Map<string, TaskDetailActivityAuthor>();

    const [agentRows, userRows] = await Promise.all([
      this.agentModel.getAgentAvatarsByIds([...agentIds]),
      UserModel.findByIds(this.db, [...userIds]),
    ]);

    for (const a of agentRows) {
      map.set(a.id, { avatar: a.avatar, id: a.id, name: a.title, type: 'agent' });
    }
    for (const u of userRows) {
      map.set(u.id, { avatar: u.avatar, id: u.id, name: u.fullName, type: 'user' });
    }

    return map;
  }
}
