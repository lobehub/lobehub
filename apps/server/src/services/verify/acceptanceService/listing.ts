import type { AcceptanceStatus, AcceptanceSubjectType } from '@lobechat/types';
import debug from 'debug';

import type {
  AcceptanceListProject,
  AcceptanceListScope,
  AcceptanceListSource,
} from '@/database/models/acceptance';
import { DocumentModel } from '@/database/models/document';
import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import type { AcceptanceItem } from '@/database/schemas/verify';
import { notTrashed } from '@/database/utils/softDelete';

import type { AcceptanceServiceDeps } from './deps';
import type { AcceptanceSubjectSummary } from './subjects';

const log = debug('lobe-server:verify-acceptance');

/** The list filter as a status set — one definition for the flat and paged reads. */
export type AcceptanceListFilter = 'active' | 'all' | 'completed';

/** Every narrowing the list panel can apply, shared by the flat and paged reads. */
export interface AcceptanceListOptions {
  filter?: AcceptanceListFilter;
  /** A project id, or `null` for acceptances filed under no project. */
  projectId?: AcceptanceListProject;
  scope?: AcceptanceListScope;
  source?: AcceptanceListSource;
}

export const statusesForFilter = (filter: AcceptanceListFilter): AcceptanceStatus[] | undefined => {
  if (filter === 'active')
    return ['pending', 'planned', 'verifying', 'repairing', 'delivered', 'rejected', 'errored'];
  if (filter === 'completed') return ['accepted', 'closed'];
  return undefined;
};

/** Resolve list subjects in one query per entity type, regardless of history size. */
export const resolveSubjects = async (
  deps: AcceptanceServiceDeps,
  acceptances: AcceptanceItem[],
): Promise<Map<string, AcceptanceSubjectSummary>> => {
  const result = new Map<string, AcceptanceSubjectSummary>();
  const idsByType = new Map<AcceptanceSubjectType, string[]>();
  for (const acceptance of acceptances) {
    const type = acceptance.subjectType as AcceptanceSubjectType;
    const ids = idsByType.get(type) ?? [];
    ids.push(acceptance.subjectId);
    idsByType.set(type, ids);
  }

  try {
    const [tasks, topics, documents] = await Promise.all([
      new TaskModel(deps.db, deps.userId, deps.workspaceId).resolveRefs(
        idsByType.get('task') ?? [],
      ),
      // Creator-facing lookup: exclude agent-share visitor topics from the
      // subject summary batch.
      new TopicModel(deps.db, deps.userId, deps.workspaceId).findOwnTopicsByIds(
        idsByType.get('topic') ?? [],
      ),
      new DocumentModel(deps.db, deps.userId, deps.workspaceId).findByIds(
        idsByType.get('document') ?? [],
      ),
    ]);
    const taskTitles = new Map<string, string | null>();
    for (const [ref, task] of tasks.byRef) {
      const title = task.name ?? task.identifier;
      taskTitles.set(ref, title);
    }
    const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title ?? null]));
    const documentTitles = new Map(
      documents.map((document) => [document.id, document.title ?? null]),
    );

    for (const acceptance of acceptances) {
      const type = acceptance.subjectType as AcceptanceSubjectType;
      const override = acceptance.metadata?.title;
      const overrideTitle =
        typeof override === 'string' && override.trim() ? override.trim() : null;
      const title =
        overrideTitle ??
        (type === 'task'
          ? taskTitles.get(acceptance.subjectId)
          : type === 'topic'
            ? topicTitles.get(acceptance.subjectId)
            : type === 'document'
              ? documentTitles.get(acceptance.subjectId)
              : null) ??
        null;
      result.set(acceptance.id, { id: acceptance.subjectId, title, type });
    }
  } catch (error) {
    log('resolveSubjects failed (non-fatal): %O', error);
    for (const acceptance of acceptances) {
      result.set(acceptance.id, {
        id: acceptance.subjectId,
        title: typeof acceptance.metadata?.title === 'string' ? acceptance.metadata.title : null,
        type: acceptance.subjectType as AcceptanceSubjectType,
      });
    }
  }
  return result;
};

/** Resolve the projects referenced directly by acceptances in one bounded read. */
export const resolveProjects = async (
  deps: AcceptanceServiceDeps,
  acceptances: AcceptanceItem[],
): Promise<Map<string, { id: string; name: string }>> => {
  const result = new Map<string, { id: string; name: string }>();
  const projectIds = [
    ...new Set(acceptances.map(({ projectId }) => projectId).filter((id): id is string => !!id)),
  ];
  if (projectIds.length === 0) return result;

  try {
    const projects = await new ProjectModel(deps.db, deps.userId, deps.workspaceId).findByIds(
      projectIds,
    );
    const projectById = new Map(projects.map((project) => [project.id, project]));

    for (const acceptance of acceptances) {
      if (!acceptance.projectId) continue;
      const project = projectById.get(acceptance.projectId);
      if (project) result.set(acceptance.id, { id: project.id, name: project.name });
    }
  } catch (error) {
    log('resolveProjects failed (non-fatal): %O', error);
  }
  return result;
};

/**
 * The latest round's total-check count per acceptance — a cheap glance for the
 * list panel (two batched reads, never a per-row union recompute). The signed-
 * off/accepted count would need the cross-round union per row, which is far too
 * heavy for a list, so the panel shows the total and leans on the row's status
 * glyph for the decision state.
 */
export const latestCheckCounts = async (
  deps: AcceptanceServiceDeps,
  acceptanceIds: string[],
): Promise<Map<string, number>> => {
  const out = new Map<string, number>();
  if (acceptanceIds.length === 0) return out;

  const runs = await deps.db.query.verifyRuns.findMany({
    columns: { acceptanceId: true, id: true, roundIndex: true },
    where: (run, { inArray }) => inArray(run.acceptanceId, acceptanceIds),
  });
  const latest = new Map<string, { id: string; round: number }>();
  for (const run of runs) {
    if (!run.acceptanceId) continue;
    const round = run.roundIndex ?? 0;
    const cur = latest.get(run.acceptanceId);
    if (!cur || round > cur.round) latest.set(run.acceptanceId, { id: run.id, round });
  }

  // Unscoped on purpose, like the run read above: the run ids derive from
  // acceptance ids the caller's list query already authorized, and a
  // participated row's report belongs to its owner — an owner-scoped read
  // would need one query per owner.
  const runIds = [...latest.values()].map((v) => v.id);
  const reports =
    runIds.length > 0
      ? await deps.db.query.verifyReports.findMany({
          columns: { totalChecks: true, verifyRunId: true },
          where: (report, { inArray }) => inArray(report.verifyRunId, runIds),
        })
      : [];
  const totalByRun = new Map(reports.map((report) => [report.verifyRunId, report.totalChecks]));
  for (const [acceptanceId, { id: runId }] of latest) {
    const total = totalByRun.get(runId);
    if (total != null) out.set(acceptanceId, total);
  }
  return out;
};

export const isInOwnScope = (deps: AcceptanceServiceDeps, row: AcceptanceItem) =>
  row.workspaceId
    ? row.workspaceId === deps.workspaceId
    : !deps.workspaceId && row.userId === deps.userId;

export const resolveForeignSubjects = async (
  deps: AcceptanceServiceDeps,
  rows: AcceptanceItem[],
): Promise<Map<string, AcceptanceSubjectSummary>> => {
  const result = new Map<string, AcceptanceSubjectSummary>();
  if (rows.length === 0) return result;

  const idsOf = (type: AcceptanceSubjectType) =>
    rows.filter((row) => row.subjectType === type).map((row) => row.subjectId);
  const titles = new Map<string, string | null>();
  try {
    const [taskIds, topicIds, documentIds] = [idsOf('task'), idsOf('topic'), idsOf('document')];
    const [taskRows, topicRows, documentRows] = await Promise.all([
      taskIds.length > 0
        ? deps.db.query.tasks.findMany({
            columns: { id: true, identifier: true, name: true },
            where: (task, { and, inArray }) =>
              and(inArray(task.id, taskIds), notTrashed(task.isDeleted)),
          })
        : [],
      topicIds.length > 0
        ? deps.db.query.topics.findMany({
            columns: { id: true, title: true },
            where: (topic, { and, inArray }) =>
              and(inArray(topic.id, topicIds), notTrashed(topic.isDeleted)),
          })
        : [],
      documentIds.length > 0
        ? deps.db.query.documents.findMany({
            columns: { id: true, title: true },
            where: (document, { and, inArray }) =>
              and(inArray(document.id, documentIds), notTrashed(document.isDeleted)),
          })
        : [],
    ]);
    for (const task of taskRows) titles.set(`task:${task.id}`, task.name ?? task.identifier);
    for (const topic of topicRows) titles.set(`topic:${topic.id}`, topic.title ?? null);
    for (const document of documentRows)
      titles.set(`document:${document.id}`, document.title ?? null);
  } catch (error) {
    log('resolveForeignSubjects failed (non-fatal): %O', error);
  }

  for (const row of rows) {
    const override = row.metadata?.title;
    const overrideTitle = typeof override === 'string' && override.trim() ? override.trim() : null;
    result.set(row.id, {
      id: row.subjectId,
      title: overrideTitle ?? titles.get(`${row.subjectType}:${row.subjectId}`) ?? null,
      type: row.subjectType as AcceptanceSubjectType,
    });
  }
  return result;
};
