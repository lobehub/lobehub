import type {
  TaskAssignmentKind,
  TaskAutomationSnapshot,
  TaskDetailActivity,
  TaskDetailActivityAuthor,
  TaskDetailData,
  TaskDetailSubtask,
  TaskDetailWorkspaceNode,
  TaskStatus,
  TaskTopicHandoff,
  WorkspaceData,
} from '@lobechat/types';
import pMap from 'p-map';

import { AgentModel } from '@/database/models/agent';
import { GoalGraphModel } from '@/database/models/goalGraph';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { UserModel } from '@/database/models/user';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { extractFileIdsFromEditorData } from '../file/extractFileIdsFromEditorData';
import { resolveAttachmentMetadata } from '../file/resolveAttachments';
import { resolveTaskAcceptance } from '../verify/taskAcceptance';
import { collapseActivityLog } from './collapseActivityLog';
import { projectTaskDetailState } from './detailProjection';

const emptyWorkspace: WorkspaceData = { nodeMap: {}, tree: [] };
const UNTITLED_TOPIC_TITLE = 'Untitled';
const TASK_DETAIL_DIRECT_TOPIC_LIMIT = 100;
/**
 * Newest raw activity rows read per detail fetch, before collapsing. The
 * detail page polls every few seconds while work is in flight, so it must not
 * ship a long-lived task's whole append-only history each time; the table
 * keeps everything for an audit view.
 */
const TASK_DETAIL_ACTIVITY_LIMIT = 200;
const TASK_DETAIL_DESCENDANT_TOPIC_LIMIT = 300;

type DirectTaskTopicActivityRow = Awaited<ReturnType<TaskTopicModel['findWithHandoff']>>[number];
type DescendantTaskTopicActivityRow = Awaited<
  ReturnType<TaskTopicModel['findWithHandoffByTaskIds']>
>[number];
type TaskTopicActivityRow = DirectTaskTopicActivityRow &
  Partial<
    Pick<
      DescendantTaskTopicActivityRow,
      'sourceTaskAssigneeAgentId' | 'sourceTaskId' | 'sourceTaskIdentifier' | 'sourceTaskName'
    >
  >;

/**
 * Assembles the task detail payload. Kept apart from `TaskService` so readers
 * that `TaskService` itself depends on (the agent runtime) can load a task
 * without an import cycle.
 */
export class TaskDetailService {
  private agentModel: AgentModel;
  private db: LobeChatDatabase;
  private taskModel: TaskModel;
  private taskTopicModel: TaskTopicModel;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.agentModel = new AgentModel(db, userId, workspaceId);
    this.taskModel = new TaskModel(db, userId, workspaceId);
    this.taskTopicModel = new TaskTopicModel(db, userId, workspaceId);
  }

  async getTaskDetail(taskIdOrIdentifier: string): Promise<TaskDetailData | null> {
    let task = await this.taskModel.resolve(taskIdOrIdentifier);
    if (!task) return null;

    // Auto-detect heartbeat timeout for running tasks before assembling detail.
    if (task.status === 'running' && task.heartbeatTimeout && task.lastHeartbeatAt) {
      const elapsed = (Date.now() - new Date(task.lastHeartbeatAt).getTime()) / 1000;
      if (elapsed > task.heartbeatTimeout) {
        await this.taskModel.updateStatus(task.id, 'paused', { error: 'Heartbeat timeout' });
        await this.taskTopicModel.timeoutRunning(task.id);
        task = await this.taskModel.resolve(taskIdOrIdentifier);
        if (!task) return null;
      }
    }

    // Clear stale heartbeat timeout error once the task is no longer running.
    if (task.status !== 'running' && task.error === 'Heartbeat timeout') {
      await this.taskModel.update(task.id, { error: null });
      task = { ...task, error: null };
    }

    // Brief hidden: the task detail activity feed no longer carries
    // brief-type activities — the UI converges on Task Run. Briefs are therefore
    // not fetched/enriched here (see the omitted brief spread below). The brief
    // lifecycle, model and data are untouched; revert this to bring them back.
    const [
      allDescendants,
      dependencies,
      directTopics,
      comments,
      activityLogs,
      workspace,
      acceptance,
      goal,
    ] = await Promise.all([
      this.taskModel.findAllDescendants(task.id),
      this.taskModel.getDependencies(task.id),
      this.taskTopicModel.findWithHandoff(task.id, TASK_DETAIL_DIRECT_TOPIC_LIMIT).catch(() => []),
      this.taskModel.getComments(task.id).catch(() => []),
      this.taskModel.getActivities(task.id, TASK_DETAIL_ACTIVITY_LIMIT).catch(() => []),
      this.taskModel.getTreePinnedDocuments(task.id).catch(() => emptyWorkspace),
      resolveTaskAcceptance(this.db, this.userId, task.id, this.workspaceId).catch(() => undefined),
      // The goal this task belongs to, so the page can link back to it
      new GoalGraphModel(this.db, this.userId, this.workspaceId)
        .findGoalByTaskId(task.id)
        .catch(() => undefined),
    ]);

    // What the reader is shown, not what was written: a burst of edits to one
    // property by one person folds into a single "from A to C", and a value
    // that ended up where it started is not shown at all. The rows themselves
    // stay append-only.
    const shownLogs = collapseActivityLog(activityLogs);

    const allDescendantIds = allDescendants.map((s) => s.id);
    const descendantTaskMap = new Map(allDescendants.map((s) => [s.id, s]));
    const descendantTopics =
      allDescendantIds.length > 0
        ? await this.taskTopicModel
            .findWithHandoffByTaskIds(allDescendantIds, TASK_DETAIL_DESCENDANT_TOPIC_LIMIT)
            .catch(() => [])
        : [];

    const topics: TaskTopicActivityRow[] = [
      ...directTopics,
      ...descendantTopics.map((topic) => {
        const sourceTask = descendantTaskMap.get(topic.sourceTaskId);
        return {
          ...topic,
          sourceTaskAssigneeAgentId:
            topic.sourceTaskAssigneeAgentId ?? sourceTask?.assigneeAgentId ?? null,
          sourceTaskId: topic.sourceTaskId ?? sourceTask?.id ?? null,
          sourceTaskIdentifier: topic.sourceTaskIdentifier ?? sourceTask?.identifier ?? null,
          sourceTaskName: topic.sourceTaskName ?? sourceTask?.name ?? null,
        };
      }),
    ];

    // Derive fileIds from persisted editor_data (single source of truth).
    const extractCtx = { db: this.db, userId: this.userId, workspaceId: this.workspaceId };
    const [taskFileIds, commentFileIdLists] = await Promise.all([
      extractFileIdsFromEditorData(task.editorData, extractCtx),
      pMap(comments, (c) => extractFileIdsFromEditorData(c.editorData, extractCtx), {
        concurrency: 10,
      }),
    ]);
    const commentFileIdsMap: Record<string, string[]> = {};
    comments.forEach((c, i) => {
      const ids = commentFileIdLists[i];
      if (ids.length > 0) commentFileIdsMap[c.id] = ids;
    });

    const allFileIds = [...taskFileIds, ...Object.values(commentFileIdsMap).flat()];
    const allFileMetadata = await resolveAttachmentMetadata({
      db: this.db,
      fileIds: allFileIds,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
    const fileById = new Map(allFileMetadata.map((f) => [f.id, f]));
    const taskFiles = taskFileIds.map((id) => fileById.get(id)).filter((f) => !!f);

    const [allDescendantDeps, allDescendantTopics] =
      allDescendantIds.length > 0
        ? await Promise.all([
            this.taskModel.getDependenciesByTaskIds(allDescendantIds).catch(() => []),
            this.taskTopicModel.findRunningByTaskIds(allDescendantIds).catch(() => []),
          ])
        : [[], []];

    // Build dependency map for all descendants
    const idToIdentifier = new Map(allDescendants.map((s) => [s.id, s.identifier]));
    const depMap = new Map<string, string>();
    for (const dep of allDescendantDeps) {
      const depId = idToIdentifier.get(dep.dependsOnId);
      if (depId) depMap.set(dep.taskId, depId);
    }

    const runningTopicByTaskId = new Map<string, (typeof allDescendantTopics)[number]>();
    for (const topic of allDescendantTopics) {
      if (!runningTopicByTaskId.has(topic.taskId)) runningTopicByTaskId.set(topic.taskId, topic);
    }

    // Build nested subtask tree
    const childrenMap = new Map<string, typeof allDescendants>();
    for (const t of allDescendants) {
      const parentId = t.parentTaskId!;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(t);
    }

    // Resolve subtask assignee agents in batch so the UI can render avatars
    // without depending on client-side agent store state.
    const subtaskAssigneeIds = [
      ...new Set(
        allDescendants.map((s) => s.assigneeAgentId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const subtaskAgents =
      subtaskAssigneeIds.length > 0
        ? await this.agentModel.getAgentAvatarsByIds(subtaskAssigneeIds)
        : [];
    const subtaskAgentMap = new Map(subtaskAgents.map((a) => [a.id, a]));

    const buildSubtaskTree = (parentId: string): TaskDetailSubtask[] | undefined => {
      const children = childrenMap.get(parentId);
      if (!children || children.length === 0) return undefined;
      return children.map((s) => {
        const agent = s.assigneeAgentId ? subtaskAgentMap.get(s.assigneeAgentId) : undefined;
        const runningTopic = runningTopicByTaskId.get(s.id);
        return {
          ...(agent
            ? {
                assignee: {
                  avatar: agent.avatar,
                  backgroundColor: agent.backgroundColor,
                  id: agent.id,
                  title: agent.title,
                },
              }
            : {}),
          ...(s.archivedAt ? { archivedAt: new Date(s.archivedAt).toISOString() } : {}),
          assigneeUserId: s.assigneeUserId,
          automationMode: s.automationMode,
          blockedBy: depMap.get(s.id),
          createdByUserId: s.createdByUserId,
          visibility: s.visibility,
          children: buildSubtaskTree(s.id),
          ...(s.heartbeatInterval != null ? { heartbeat: { interval: s.heartbeatInterval } } : {}),
          identifier: s.identifier,
          name: s.name,
          priority: s.priority,
          ...(runningTopic?.topicId
            ? {
                runningTopic: {
                  id: runningTopic.topicId,
                  operationId: runningTopic.operationId ?? null,
                },
              }
            : {}),
          ...(s.schedulePattern || s.scheduleTimezone
            ? { schedule: { pattern: s.schedulePattern, timezone: s.scheduleTimezone } }
            : {}),
          status: s.status,
          updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : undefined,
        };
      });
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
    let parent: { agentId: string | null; identifier: string; name: string | null } | null = null;
    if (task.parentTaskId) {
      const parentTask = await this.taskModel.findById(task.parentTaskId);
      if (parentTask) {
        parent = {
          agentId: parentTask.assigneeAgentId,
          identifier: parentTask.identifier,
          name: parentTask.name,
        };
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
          inaccessible: doc?.inaccessible,
          size: doc?.charCount,
          sourceTaskId: doc?.sourceTaskId,
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

    // Each topic keeps the agent that actually ran it (topics.agentId), so an
    // earlier run's avatar stays correct after the task is reassigned. Fall back
    // to the source task assignee, then the current task assignee, only when a
    // topic has no recorded agent.
    for (const t of topics) {
      const topicAgentId = t.agentId ?? t.sourceTaskAssigneeAgentId ?? task.assigneeAgentId;
      if (topicAgentId) agentIds.add(topicAgentId);
    }
    // Comments have authorAgentId or authorUserId
    for (const c of comments) {
      if (c.authorAgentId) agentIds.add(c.authorAgentId);
      if (c.authorUserId) userIds.add(c.authorUserId);
    }
    // Creator of the task itself (agent takes precedence over user)
    if (task.createdByAgentId) agentIds.add(task.createdByAgentId);
    else if (task.createdByUserId) userIds.add(task.createdByUserId);
    // Assignment events carry an actor plus both sides of the change; which
    // set an id belongs to is decided by the event type, not by the column.
    for (const log of shownLogs) {
      if (log.actorAgentId) agentIds.add(log.actorAgentId);
      if (log.actorUserId) userIds.add(log.actorUserId);
      // Property events carry values, not participant ids.
      if (log.type !== 'assignee_agent' && log.type !== 'assignee_user') continue;
      const target = log.type === 'assignee_agent' ? agentIds : userIds;
      for (const id of [log.payload?.fromId, log.payload?.toId]) if (id) target.add(id);
    }

    const authorMap = await this.resolveAuthors(agentIds, userIds);

    // Every run row answers "and did it pass?" on its own (with counts). Without this the
    // activity feed lists rounds that all look alike, and the only way to learn
    // a round's verdict is to leave for the acceptance page.
    const verifyByOperation = await new VerifyRunModel(this.db, this.userId, this.workspaceId)
      .findByOperations(topics.map((t) => t.operationId).filter((id): id is string => Boolean(id)))
      .catch(() => new Map());

    const creatorId = task.createdByAgentId ?? task.createdByUserId;
    const createdActivity: TaskDetailActivity | null =
      task.createdAt && creatorId
        ? {
            author: authorMap.get(creatorId),
            time: toISO(task.createdAt),
            type: 'created' as const,
          }
        : null;

    const activities: TaskDetailActivity[] = [
      ...(createdActivity ? [createdActivity] : []),
      ...topics.map((t) => {
        const handoff = t.handoff as TaskTopicHandoff | null;
        const topicAgentId = t.agentId ?? t.sourceTaskAssigneeAgentId ?? task.assigneeAgentId;
        const verifyRun = t.operationId ? verifyByOperation.get(t.operationId) : undefined;
        return {
          author: topicAgentId ? authorMap.get(topicAgentId) : undefined,
          completedAt: toISO(t.completedAt),
          cost: t.totalCost == null ? null : Number(t.totalCost),
          // Raw last assistant message of the run, shown alongside
          // the synthesized summary on the run card.
          content: handoff?.content,
          id: t.topicId ?? undefined,
          operationId: t.operationId ?? null,
          runningOperation: t.metadata?.runningOperation ?? null,
          seq: t.seq,
          status: t.status,
          summary: handoff?.summary,
          sourceTaskId: t.sourceTaskId,
          sourceTaskIdentifier: t.sourceTaskIdentifier,
          sourceTaskName: t.sourceTaskName,
          time: toISO(t.createdAt),
          title: handoff?.title || t.title || UNTITLED_TOPIC_TITLE,
          // What opened this round. Without it the feed cannot distinguish a run
          // the user started from one the goal coordinator / scheduler opened on its
          // own — they render identically apart from `#seq`.
          trigger: t.trigger ?? null,
          verify: verifyRun
            ? {
                acceptanceId: verifyRun.acceptanceId,
                passed: verifyRun.passed,
                roundIndex: verifyRun.roundIndex,
                runId: verifyRun.id,
                status: verifyRun.status,
                total: verifyRun.total,
              }
            : null,
          type: 'topic' as const,
        };
      }),
      // Brief activities intentionally omitted — see the fetch note above.
      ...comments.map((c) => {
        const ids = commentFileIdsMap[c.id] ?? [];
        const files = ids.map((id) => fileById.get(id)).filter((f) => !!f);
        return {
          agentId: c.authorAgentId,
          author: c.authorAgentId
            ? authorMap.get(c.authorAgentId)
            : c.authorUserId
              ? authorMap.get(c.authorUserId)
              : undefined,
          content: c.content,
          editorData: c.editorData ?? undefined,
          files: files.length > 0 ? files : undefined,
          id: c.id,
          time: toISO(c.createdAt),
          type: 'comment' as const,
        };
      }),
      ...shownLogs.map((log): TaskDetailActivity => {
        const stub = (id: string, type: 'agent' | 'user'): TaskDetailActivityAuthor => ({
          id,
          name: null,
          type,
          unresolved: true,
        });
        const actorKind = log.payload?.actorKind;
        const author = log.actorAgentId
          ? (authorMap.get(log.actorAgentId) ?? stub(log.actorAgentId, 'agent'))
          : log.actorUserId
            ? (authorMap.get(log.actorUserId) ?? stub(log.actorUserId, 'user'))
            : actorKind === 'agent' || actorKind === 'user'
              ? // Somebody did it but their row is gone: the actor columns are
                // cleared on delete, and only the payload remembers there was
                // a person. Must not read as the system.
                stub('', actorKind)
              : // Genuinely nobody: the runner's system fallback.
                undefined;

        if (log.type === 'status' || log.type === 'priority' || log.type === 'automation') {
          const from = log.payload?.from ?? null;
          const to = log.payload?.to ?? null;
          const propertyChange: NonNullable<TaskDetailActivity['propertyChange']> =
            log.type === 'status'
              ? { field: 'status', from: from as TaskStatus | null, to: to as TaskStatus }
              : log.type === 'priority'
                ? { field: 'priority', from: from as number | null, to: to as number | null }
                : {
                    field: 'automation',
                    from: from as TaskAutomationSnapshot | null,
                    to: to as TaskAutomationSnapshot | null,
                  };
          return {
            author,
            id: log.id,
            propertyChange,
            time: toISO(log.createdAt),
            type: 'property',
          };
        }

        const kind: TaskAssignmentKind = log.type === 'assignee_agent' ? 'agent' : 'member';
        // A missing author row means the participant is gone, or is private to
        // another member and filtered out of this viewer's scope. Keep a stub
        // instead of collapsing to `null`/`undefined`: `null` reads as
        // "unassigned" (turning a reassignment into a removal) and an absent
        // actor reads as the system (falsely crediting it for an agent's work).
        const resolveSide = (id?: string | null): TaskDetailActivityAuthor | null => {
          if (!id) return null;
          return authorMap.get(id) ?? stub(id, kind === 'agent' ? 'agent' : 'user');
        };
        return {
          assignment: {
            from: resolveSide(log.payload?.fromId),
            kind,
            to: resolveSide(log.payload?.toId),
          },
          author,
          id: log.id,
          time: toISO(log.createdAt),
          type: 'assignment' as const,
        };
      }),
    ].sort((a, b) => {
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });

    const taskConfig = task.config ? (task.config as Record<string, unknown>) : undefined;

    return {
      ...projectTaskDetailState(task, taskConfig),
      agentId: task.assigneeAgentId,
      automationMode: task.automationMode ?? null,
      checkpoint: this.taskModel.getCheckpointConfig(task),
      config: taskConfig,
      createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : undefined,
      createdByUserId: task.createdByUserId,
      dependencies: dependencies.map((d) => {
        const info = depIdToInfo.get(d.dependsOnId);
        return {
          dependsOn: info?.identifier ?? d.dependsOnId,
          name: info?.name,
          type: d.type,
        };
      }),
      description: task.description,
      editorData: task.editorData ?? undefined,
      error: task.error,
      goal: goal ?? null,
      files: taskFiles.length > 0 ? taskFiles : undefined,
      id: task.id,
      identifier: task.identifier,
      instruction: task.instruction,
      name: task.name,
      parent,
      priority: task.priority,
      startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
      status: task.status,
      userId: task.assigneeUserId,
      verify: acceptance
        ? { ...acceptance.config, requirement: acceptance.requirement }
        : this.taskModel.getVerifyConfig(task),
      visibility: task.visibility,
      subtasks,
      activities: activities.length > 0 ? activities : undefined,
      topicCount: topics.length > 0 ? topics.length : undefined,
      updatedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : undefined,
      workspace: workspaceFolders.length > 0 ? workspaceFolders : undefined,
      workspaceId: task.workspaceId ?? null,
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

    // Both display columns are nullable, so fall back to the other one the
    // query already returns rather than letting a live participant render as
    // nameless — the UI reserves its nameless labels for absent identities.
    for (const a of agentRows) {
      map.set(a.id, { avatar: a.avatar, id: a.id, name: a.title || a.name, type: 'agent' });
    }
    for (const u of userRows) {
      map.set(u.id, { avatar: u.avatar, id: u.id, name: u.fullName || u.username, type: 'user' });
    }

    return map;
  }
}
