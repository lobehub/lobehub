import { buildTaskRunPrompt } from '@lobechat/prompts';
import type { TaskItem, TaskTopicHandoff, WorkspaceData } from '@lobechat/types';

import type { BriefModel } from '@/database/models/brief';
import type { TaskModel } from '@/database/models/task';
import type { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';
import { extractFileIdsFromEditorData } from '@/server/services/file/extractFileIdsFromEditorData';
import { resolveAttachmentMetadata } from '@/server/services/file/resolveAttachments';

export interface BuildTaskPromptDeps {
  briefModel: BriefModel;
  db: LobeChatDatabase;
  taskModel: TaskModel;
  taskTopicModel: TaskTopicModel;
  userId: string;
  workspaceId?: string;
}

export interface BuiltTaskPrompt {
  /** Merged, deduplicated list of fileIds (task instruction + all comments)
   * to forward to execAgent so files arrive as multimodal inputs. */
  fileIds: string[];
  prompt: string;
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
): Promise<BuiltTaskPrompt> {
  const { briefModel, db, taskModel, taskTopicModel, userId, workspaceId } = deps;

  const [topics, briefs, comments, subtasks, dependencies, documents] = await Promise.all([
    task.totalTopics && task.totalTopics > 0
      ? taskTopicModel.findWithHandoff(task.id, 4).catch(() => [])
      : Promise.resolve([]),
    briefModel.findByTaskId(task.id).catch(() => []),
    taskModel.getComments(task.id).catch(() => []),
    taskModel.findSubtasks(task.id).catch(() => []),
    taskModel.getDependencies(task.id).catch(() => []),
    taskModel
      .getTreePinnedDocuments(task.id)
      .catch((): WorkspaceData => ({ nodeMap: {}, tree: [] })),
  ]);

  // Derive fileIds from the persisted Lexical state. editor_data is the
  // single source of truth — fileId is recovered from the URL in each node
  // (proxy URL form via regex; pre-signed dev URLs via files.url lookup).
  const extractCtx = { db, userId, workspaceId };
  const [taskFileIds, ...commentFileIdLists] = await Promise.all([
    extractFileIdsFromEditorData(task.editorData, extractCtx),
    ...comments.map((c) => extractFileIdsFromEditorData(c.editorData, extractCtx)),
  ]);
  const commentFileIdsMap: Record<string, string[]> = {};
  comments.forEach((c, i) => {
    const ids = commentFileIdLists[i];
    if (ids.length > 0) commentFileIdsMap[c.id] = ids;
  });

  // Metadata-only lookup (name + fileType) for prompt rendering. Full content
  // for the agent comes via `execAgent.fileIds` → `resolveAttachmentsByFileIds`.
  // `signUrls: false` skips presigned-URL fetches we don't need for prompts.
  const allFileIds = Array.from(
    new Set([...taskFileIds, ...Object.values(commentFileIdsMap).flat()]),
  );
  const fileMetadata = await resolveAttachmentMetadata({
    db,
    fileIds: allFileIds,
    signUrls: false,
    userId,
    workspaceId,
  });
  const fileMetaById = new Map(fileMetadata.map((f) => [f.id, f]));

  const toFileMetas = (ids: string[]) =>
    ids
      .map((id) => fileMetaById.get(id))
      .filter((f): f is (typeof fileMetadata)[number] => !!f)
      .map((f) => ({ fileType: f.fileType, id: f.id, name: f.name }));

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

  const taskFiles = toFileMetas(taskFileIds);

  const prompt = buildTaskRunPrompt({
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
      comments: comments.map((c: any) => {
        const files = toFileMetas(commentFileIdsMap[c.id] ?? []);
        return {
          agentId: c.authorAgentId,
          content: c.content,
          createdAt: c.createdAt,
          ...(files.length > 0 ? { files } : {}),
          id: c.id,
        };
      }),
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
      ...(taskFiles.length > 0 ? { files: taskFiles } : {}),
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

  return { fileIds: allFileIds, prompt };
}
