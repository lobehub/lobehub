import { buildTaskRunPrompt } from '@lobechat/prompts';
import type { TaskItem, TaskTopicHandoff, WorkspaceData } from '@lobechat/types';

import type { BriefModel } from '@/database/models/brief';
import type { TaskModel } from '@/database/models/task';
import type { TaskTopicModel } from '@/database/models/taskTopic';

export interface BuildTaskPromptDeps {
  briefModel: BriefModel;
  taskModel: TaskModel;
  taskTopicModel: TaskTopicModel;
}

/**
 * Server-side orchestrator: fetches task context from the DB and renders the
 * prompt that `task.run` injects into the agent runtime.
 *
 * Pure prompt rendering lives in `@lobechat/prompts` (`buildTaskRunPrompt`).
 * This wrapper is the DB-aware layer that assembles the input from models.
 */
export async function buildTaskPrompt(
  task: TaskItem,
  deps: BuildTaskPromptDeps,
  extraPrompt?: string,
): Promise<string> {
  const { briefModel, taskModel, taskTopicModel } = deps;

  const [topics, briefs, comments, subtasks, dependencies, documents] = await Promise.all([
    task.totalTopics && task.totalTopics > 0
      ? taskTopicModel.findWithHandoff(task.id).catch(() => [])
      : Promise.resolve([]),
    briefModel.findByTaskId(task.id).catch(() => []),
    taskModel.getComments(task.id).catch(() => []),
    taskModel.findSubtasks(task.id).catch(() => []),
    taskModel.getDependencies(task.id).catch(() => []),
    taskModel
      .getTreePinnedDocuments(task.id)
      .catch((): WorkspaceData => ({ nodeMap: {}, tree: [] })),
  ]);

  const subtaskIds = subtasks.map((s: any) => s.id);
  const subtaskDeps =
    subtaskIds.length > 0
      ? await taskModel.getDependenciesByTaskIds(subtaskIds).catch(() => [])
      : [];
  const subtaskIdToIdentifier = new Map(subtasks.map((s: any) => [s.id, s.identifier]));
  const subtaskDepMap = new Map<string, string>();
  for (const dep of subtaskDeps as any[]) {
    const depIdentifier = subtaskIdToIdentifier.get(dep.dependsOnId);
    if (depIdentifier) subtaskDepMap.set(dep.taskId, depIdentifier);
  }

  const depTaskIds = [...new Set(dependencies.map((d: any) => d.dependsOnId))];
  const depTasks = await taskModel.findByIds(depTaskIds);
  const depIdToIdentifier = new Map(depTasks.map((t: any) => [t.id, t.identifier]));

  let parentIdentifier: string | null = null;
  let parentTaskContext:
    | {
        identifier: string;
        instruction: string;
        name?: string | null;
        subtasks?: Array<{
          blockedBy?: string;
          identifier: string;
          name?: string | null;
          priority?: number | null;
          status: string;
        }>;
      }
    | undefined;

  if (task.parentTaskId) {
    const parent = await taskModel.findById(task.parentTaskId);
    parentIdentifier = parent?.identifier || null;
    if (parent) {
      const siblings = await taskModel.findSubtasks(task.parentTaskId).catch(() => []);
      const siblingIds = siblings.map((s: any) => s.id);
      const siblingDeps =
        siblingIds.length > 0
          ? await taskModel.getDependenciesByTaskIds(siblingIds).catch(() => [])
          : [];
      const siblingIdToIdentifier = new Map(siblings.map((s: any) => [s.id, s.identifier]));
      const siblingDepMap = new Map<string, string>();
      for (const dep of siblingDeps as any[]) {
        const depId = siblingIdToIdentifier.get(dep.dependsOnId);
        if (depId) siblingDepMap.set(dep.taskId, depId);
      }

      parentTaskContext = {
        identifier: parent.identifier,
        instruction: parent.instruction,
        name: parent.name,
        subtasks: siblings.map((s: any) => ({
          blockedBy: siblingDepMap.get(s.id),
          identifier: s.identifier,
          name: s.name,
          priority: s.priority,
          status: s.status,
        })),
      };
    }
  }

  return buildTaskRunPrompt({
    activities: {
      briefs: briefs.map((b: any) => ({
        createdAt: b.createdAt,
        id: b.id,
        priority: b.priority,
        resolvedAction: b.resolvedAction,
        resolvedAt: b.resolvedAt,
        resolvedComment: b.resolvedComment,
        summary: b.summary,
        title: b.title,
        type: b.type,
      })),
      comments: comments.map((c: any) => ({
        agentId: c.authorAgentId,
        content: c.content,
        createdAt: c.createdAt,
        id: c.id,
      })),
      subtasks: subtasks.map((s: any) => ({
        createdAt: s.createdAt,
        id: s.id,
        identifier: s.identifier,
        name: s.name,
        status: s.status,
      })),
      topics: (topics as any[]).map((t) => {
        const handoff = t.handoff as TaskTopicHandoff | null;
        return {
          createdAt: t.createdAt,
          handoff,
          id: t.topicId || t.id,
          seq: t.seq,
          status: t.status,
          title: handoff?.title || t.title,
        };
      }),
    },
    extraPrompt,
    parentTask: parentTaskContext,
    task: {
      assigneeAgentId: task.assigneeAgentId,
      dependencies: dependencies.map((d: any) => ({
        dependsOn: depIdToIdentifier.get(d.dependsOnId) ?? d.dependsOnId,
        type: d.type,
      })),
      description: task.description,
      id: task.id,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
      parentIdentifier,
      priority: task.priority,
      review: taskModel.getReviewConfig(task) as any,
      status: task.status,
      subtasks: subtasks.map((s: any) => ({
        blockedBy: subtaskDepMap.get(s.id),
        identifier: s.identifier,
        name: s.name,
        priority: s.priority,
        status: s.status,
      })),
    },
    workspace: documents.tree.map((rootNode) => {
      const rootDoc = documents.nodeMap[rootNode.id];
      return {
        children: rootNode.children.map((child) => {
          const childDoc = documents.nodeMap[child.id];
          return {
            createdAt: childDoc?.createdAt,
            documentId: child.id,
            size: childDoc?.charCount ?? undefined,
            sourceTaskIdentifier: childDoc?.sourceTaskIdentifier ?? undefined,
            title: childDoc?.title,
          };
        }),
        createdAt: rootDoc?.createdAt,
        documentId: rootNode.id,
        title: rootDoc?.title,
      };
    }),
  });
}
