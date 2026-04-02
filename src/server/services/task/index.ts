import type {
  TaskDetailActivity,
  TaskDetailData,
  TaskDetailWorkspaceNode,
  TaskTopicHandoff,
  WorkspaceData,
} from '@lobechat/types';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

const emptyWorkspace: WorkspaceData = { nodeMap: {}, tree: [] };

export class TaskService {
  private briefModel: BriefModel;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.taskModel = new TaskModel(db, userId);
    this.taskTopicModel = new TaskTopicModel(db, userId);
    this.briefModel = new BriefModel(db, userId);
  }

  async getTaskDetail(taskIdOrIdentifier: string): Promise<TaskDetailData | null> {
    const task = await this.taskModel.resolve(taskIdOrIdentifier);
    if (!task) return null;

    const [subtasks, dependencies, topics, briefs, comments, workspace] = await Promise.all([
      this.taskModel.findSubtasks(task.id),
      this.taskModel.getDependencies(task.id),
      this.taskTopicModel.findWithHandoff(task.id).catch(() => []),
      this.briefModel.findByTaskId(task.id).catch(() => []),
      this.taskModel.getComments(task.id).catch(() => []),
      this.taskModel.getTreePinnedDocuments(task.id).catch(() => emptyWorkspace),
    ]);

    // Build subtask dependency map
    const subtaskIds = subtasks.map((s) => s.id);
    const subtaskDeps =
      subtaskIds.length > 0
        ? await this.taskModel.getDependenciesByTaskIds(subtaskIds).catch(() => [])
        : [];
    const idToIdentifier = new Map(subtasks.map((s) => [s.id, s.identifier]));
    const depMap = new Map<string, string>();
    for (const dep of subtaskDeps) {
      const depId = idToIdentifier.get(dep.dependsOnId);
      if (depId) depMap.set(dep.taskId, depId);
    }

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

    const activities: TaskDetailActivity[] = [
      ...topics.map((t) => ({
        id: t.topicId ?? undefined,
        seq: t.seq,
        status: t.status,
        time: toISO(t.createdAt),
        title: (t.handoff as TaskTopicHandoff | null)?.title || 'Untitled',
        type: 'topic' as const,
      })),
      ...briefs.map((b) => ({
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
      subtasks: subtasks.map((s) => ({
        blockedBy: depMap.get(s.id),
        identifier: s.identifier,
        name: s.name,
        priority: s.priority,
        status: s.status,
      })),
      activities: activities.length > 0 ? activities : undefined,
      topicCount: topics.length > 0 ? topics.length : undefined,
      workspace: workspaceFolders.length > 0 ? workspaceFolders : undefined,
    };
  }
}
