import type { AcceptanceSubjectType } from '@lobechat/types';
import debug from 'debug';

import { DocumentModel } from '@/database/models/document';
import { GoalModel } from '@/database/models/goal';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { AcceptanceItem } from '@/database/schemas/verify';

import type { AcceptanceServiceDeps } from './deps';

const log = debug('lobe-server:verify-acceptance');

export interface AcceptanceSubjectSummary {
  id: string;
  title: string | null;
  type: AcceptanceSubjectType;
}

/**
 * Validate the subject exists in the caller's scope before creating an
 * aggregate for it — the table deliberately has no FK (polymorphic subject),
 * so this is where dangling aggregates are prevented.
 *
 * Resolves to the subject's canonical id. A task is addressable by its
 * identifier (`T-898`) as well as its id, but every reader keys the aggregate
 * by the id — storing the identifier left the Task page without its acceptance.
 */
export const assertSubjectExists = async (
  deps: AcceptanceServiceDeps,
  subjectType: AcceptanceSubjectType,
  subjectId: string,
): Promise<string> => {
  // Standalone acceptances are the subject themselves. They deliberately do
  // not require a Task/Topic/Document row, which keeps external repositories
  // from having to manufacture a LobeHub task before publishing evidence.
  if (subjectType === 'standalone') return subjectId;

  const found = await findSubject(deps, subjectType, subjectId);
  if (!found) {
    throw new Error(`${subjectType} "${subjectId}" not found in the current workspace`);
  }
  return found.id;
};

/** The id an aggregate is keyed by; an unknown subject passes through unchanged. */
export const resolveCanonicalSubjectId = async (
  deps: AcceptanceServiceDeps,
  subjectType: AcceptanceSubjectType,
  subjectId: string,
): Promise<string> => {
  if (subjectType !== 'task') return subjectId;
  const task = await new TaskModel(deps.db, deps.userId, deps.workspaceId).resolve(subjectId);
  return task?.id ?? subjectId;
};

export const findSubject = async (
  deps: AcceptanceServiceDeps,
  subjectType: AcceptanceSubjectType,
  subjectId: string,
): Promise<{ id: string; title: string | null } | null> => {
  switch (subjectType) {
    case 'task': {
      const task = await new TaskModel(deps.db, deps.userId, deps.workspaceId).resolve(subjectId);
      return task ? { id: task.id, title: task.name ?? task.identifier } : null;
    }
    case 'topic': {
      // Creator-facing lookup: an agent-share visitor topic must not be
      // treated as a valid acceptance subject for the creator.
      const topic = await new TopicModel(deps.db, deps.userId, deps.workspaceId).findOwnTopicById(
        subjectId,
      );
      return topic ? { id: subjectId, title: topic.title ?? null } : null;
    }
    case 'document': {
      const doc = await new DocumentModel(deps.db, deps.userId, deps.workspaceId).findById(
        subjectId,
      );
      return doc ? { id: subjectId, title: doc.title ?? null } : null;
    }
    case 'goal_gate': {
      const goal = await goalOfGate(deps, subjectId);
      return goal ? { id: subjectId, title: goal.title } : null;
    }
    case 'standalone':
    case 'site': {
      return null;
    }
  }
};

export const resolveRunTopicTaskId = async (
  deps: AcceptanceServiceDeps,
  topicId: string,
): Promise<string | undefined> => {
  const taskTopic = await new TaskTopicModel(deps.db, deps.userId, deps.workspaceId).findByTopicId(
    topicId,
  );
  if (!taskTopic) return;
  if (await deps.acceptanceModel.findBySubject('topic', topicId)) return;
  const task = await new TaskModel(deps.db, deps.userId, deps.workspaceId).findById(
    taskTopic.taskId,
  );
  if (!task || task.automationMode) return;
  return task.id;
};

/** The Goal a release-gate subject (its review node) belongs to. */
export const goalOfGate = (deps: AcceptanceServiceDeps, nodeId: string) =>
  new GoalModel(deps.db, deps.userId, deps.workspaceId).findByNode(nodeId);

/** A project named by id must be readable in the caller's scope; resolves to its id. */
export const assertProjectExists = async (
  deps: AcceptanceServiceDeps,
  projectId: string,
): Promise<string> => {
  const project = await new ProjectModel(deps.db, deps.userId, deps.workspaceId).findById(
    projectId,
  );
  if (!project) throw new Error(`project "${projectId}" not found in the current workspace`);
  return project.id;
};

export const resolveSubjectProjectId = async (
  deps: AcceptanceServiceDeps,
  subjectType: AcceptanceSubjectType,
  subjectId: string,
): Promise<string | null> => {
  if (subjectType === 'task') {
    return (
      (await new TaskModel(deps.db, deps.userId, deps.workspaceId).resolve(subjectId))?.projectId ??
      null
    );
  }
  if (subjectType === 'goal_gate') return (await goalOfGate(deps, subjectId))?.projectId ?? null;
  if (subjectType === 'topic') {
    // A project conversation carries its project itself; only a topic outside
    // one falls back to the project of the task it runs.
    const topic = await new TopicModel(deps.db, deps.userId, deps.workspaceId).findOwnTopicById(
      subjectId,
    );
    if (topic?.projectId) return topic.projectId;

    const taskTopic = await new TaskTopicModel(
      deps.db,
      deps.userId,
      deps.workspaceId,
    ).findByTopicId(subjectId);
    if (!taskTopic) return null;
    return (
      (await new TaskModel(deps.db, deps.userId, deps.workspaceId).resolve(taskTopic.taskId))
        ?.projectId ?? null
    );
  }
  return null;
};

/** Best-effort subject header info for the bundle (title may be gone). */
export const resolveSubject = async (
  deps: AcceptanceServiceDeps,
  acceptance: AcceptanceItem,
): Promise<AcceptanceSubjectSummary> => {
  // A user rename wins over the subject's own title — the sidebar entry is
  // renamed without touching the source topic/task/document.
  const override = acceptance.metadata?.title;
  let title: string | null =
    typeof override === 'string' && override.trim() ? override.trim() : null;
  if (!title) {
    try {
      title =
        (
          await findSubject(
            deps,
            acceptance.subjectType as AcceptanceSubjectType,
            acceptance.subjectId,
          )
        )?.title ?? null;
    } catch (error) {
      log('resolveSubject failed (non-fatal): %O', error);
    }
  }
  return {
    id: acceptance.subjectId,
    title,
    type: acceptance.subjectType as AcceptanceSubjectType,
  };
};
