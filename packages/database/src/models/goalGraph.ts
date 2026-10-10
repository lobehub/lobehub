import type {
  GoalDecisionAuthority,
  GoalDecisionOption,
  GoalEdgeKind,
  GoalEventActor,
  GoalEventActorType,
  GoalEventEntityType,
  GoalEventType,
  GoalGraphSnapshot,
  GoalGraphWorkVersionDisplay,
  GoalNodeKind,
  GoalNodeStatus,
  GoalNodeWorkVersionRelation,
  GoalStatus,
} from '@lobechat/types';
import { experimentMembers, experimentOwner, experimentStatus } from '@lobechat/utils/goalGraph';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { goals } from '../schemas/goal';
import {
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goalNodeWorkVersions,
} from '../schemas/goalGraph';
import { briefs, tasks } from '../schemas/task';
import { works, workVersions } from '../schemas/work';
import type { LobeChatDatabase, Transaction } from '../type';
import { notTrashed } from '../utils/softDelete';
import { buildWorkspaceWhere } from '../utils/workspace';
import { workOwnership } from './work/context';

interface EventInput {
  actorId?: string;
  actorType?: GoalEventActorType;
  entityId: string;
  entityType: GoalEventEntityType;
  eventType: GoalEventType;
  operationId?: string;
  reason?: string;
  taskId?: string;
}

interface CreateNodeInput {
  confidence?: number;
  createdByAgentId?: string;
  description?: string;
  kind: GoalNodeKind;
  priority?: number;
  questionId?: string;
  scopeId?: string;
  status?: GoalNodeStatus;
  title: string;
}

interface CreateDecisionInput {
  authority: GoalDecisionAuthority;
  options?: GoalDecisionOption[];
  question: string;
  recommendedOptionId?: string;
  requestedProjectRole?: string;
  requestedUserId?: string;
}

/** Persistence boundary for an owned Goal Graph and its append-only audit trail. */
/**
 * A goal gate is asked in two places — the goal itself and the brief that
 * carries it to the inbox. Whichever answers, the other must stop asking, so
 * every write that settles a decision settles its brief in the same transaction.
 */
const settleDecisionBriefs = async (
  tx: Transaction,
  decisionId: string,
  action: string,
  comment?: string,
) =>
  tx
    .update(briefs)
    .set({ resolvedAction: action, resolvedAt: new Date(), resolvedComment: comment ?? null })
    .where(
      and(
        isNull(briefs.resolvedAt),
        sql`${briefs.metadata} -> 'goal' ->> 'decisionId' = ${decisionId}`,
      ),
    );

export class GoalGraphModel {
  /**
   * `actor` is who the audit trail records for the transitions made through this
   * instance. It defaults to the owning user, which is right for anything a
   * person did; the coordinator passes its own so the trail can answer "did a
   * human do this, or did the system decide it".
   */
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly actor?: GoalEventActor,
  ) {}

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, goals);

  private ownedGoal = async (goalId: string, tx: LobeChatDatabase | Transaction = this.db) => {
    const [goal] = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), this.ownership()))
      .limit(1)
      .for('update');
    return goal;
  };

  private appendEvent = async (tx: Transaction, goalId: string, input: EventInput) => {
    const actor = this.actor ?? { id: this.userId, type: 'user' as const };
    const [event] = await tx
      .insert(goalEvents)
      .values({
        ...input,
        actorId: input.actorId ?? actor.id,
        actorType: input.actorType ?? actor.type,
        goalId,
      })
      .returning();
    return event;
  };

  getGraph = async (goalId: string): Promise<GoalGraphSnapshot | undefined> => {
    // Ordinary graph refreshes must not queue behind a coordinator's write lock.
    const [goal] = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), this.ownership()))
      .limit(1);
    if (!goal) return undefined;

    const [nodes, edges, decisions, events, linkedWorkVersions] = await Promise.all([
      this.db
        .select()
        .from(goalNodes)
        .where(eq(goalNodes.goalId, goalId))
        .orderBy(asc(goalNodes.createdAt)),
      this.db
        .select()
        .from(goalEdges)
        .where(eq(goalEdges.goalId, goalId))
        .orderBy(asc(goalEdges.createdAt)),
      this.db
        .select()
        .from(goalNodeDecisions)
        .innerJoin(goalNodes, eq(goalNodeDecisions.nodeId, goalNodes.id))
        .where(eq(goalNodes.goalId, goalId))
        .orderBy(asc(goalNodeDecisions.createdAt)),
      this.db
        .select()
        .from(goalEvents)
        .where(eq(goalEvents.goalId, goalId))
        .orderBy(desc(goalEvents.createdAt))
        .limit(GoalGraphModel.GRAPH_EVENT_LIMIT),
      this.db
        .select({ link: goalNodeWorkVersions })
        .from(goalNodeWorkVersions)
        .innerJoin(goalNodes, eq(goalNodeWorkVersions.nodeId, goalNodes.id))
        .where(eq(goalNodes.goalId, goalId))
        .orderBy(asc(goalNodeWorkVersions.createdAt)),
    ]);

    const linkDisplays = await this.hydrateWorkVersions(
      linkedWorkVersions.map(({ link }) => link.workVersionId),
    );

    return {
      decisions: decisions.map(({ goal_node_decisions }) => goal_node_decisions),
      edges,
      events,
      goal,
      nodes: nodes.map((node) => ({ ...node, status: experimentStatus({ nodes, edges }, node) })),
      workVersions: linkedWorkVersions.map(({ link }) => ({
        ...link,
        // A link nothing came back for still counts; it just cannot be named.
        work: linkDisplays.get(link.workVersionId),
      })),
    };
  };

  /**
   * Display snapshots for linked Work versions, keyed by version id.
   *
   * Read separately from the link rows, and gated by `workOwnership`: `goals`
   * has no visibility column, so every member of a team workspace can read a
   * workspace goal, while a Work is owner-scoped (external Works are always
   * private, document/file Works follow their backing resource). Hydrating
   * without the predicate handed another member the owner's private title,
   * status, url and document binding.
   *
   * A second small query rather than a join on the graph read: `workOwnership`
   * carries correlated EXISTS guards, and evaluating those inside the graph
   * join cost that read ~2.5x — which the detail page pays every few seconds
   * while it polls. Here they run once over a handful of linked versions, and a
   * goal with no links skips the query entirely.
   */
  private hydrateWorkVersions = async (versionIds: string[]) => {
    const display = new Map<string, GoalGraphWorkVersionDisplay>();
    const ids = [...new Set(versionIds)];
    if (ids.length === 0) return display;

    const rows = await this.db
      .select({
        identifier: workVersions.identifier,
        // Document and file Works keep their open target in the version
        // metadata rather than the `url` column.
        metadata: workVersions.metadata,
        resourceId: works.resourceId,
        status: workVersions.status,
        title: workVersions.title,
        type: works.type,
        url: workVersions.url,
        versionId: workVersions.id,
        workId: works.id,
      })
      .from(workVersions)
      .innerJoin(
        works,
        and(
          eq(workVersions.workId, works.id),
          workOwnership({ db: this.db, userId: this.userId, workspaceId: this.workspaceId }),
        ),
      )
      .where(inArray(workVersions.id, ids));

    for (const row of rows) {
      display.set(row.versionId, {
        identifier: row.identifier,
        resourceId: row.resourceId,
        status: row.status,
        title: row.title,
        type: row.type,
        url: row.url,
        workId: row.workId,
        ...(row.metadata?.agentDocumentId ? { agentDocumentId: row.metadata.agentDocumentId } : {}),
        ...(row.metadata?.fileUrl ? { fileUrl: row.metadata.fileUrl } : {}),
        ...(row.metadata?.fileId ? { fileId: row.metadata.fileId } : {}),
        ...(typeof row.metadata?.fileSize === 'number' ? { fileSize: row.metadata.fileSize } : {}),
        ...(row.metadata?.mimeType ? { mimeType: row.metadata.mimeType } : {}),
      });
    }
    return display;
  };

  /**
   * How many events one graph read carries.
   *
   * `getGraph` backs both the coordinator (which never reads events) and the
   * detail page (which polls it every few seconds and renders the most recent
   * lifecycle entries), so the read has to be bounded: a long-horizon goal
   * accumulates events for months and an unbounded query made every poll's
   * payload — and the client's rebuild cost — grow linearly with goal age.
   * Newest wins: the audit trail's full history stays queryable in the
   * database, and the trajectory (`lh trace goal`) already records decisions
   * with more fidelity than these events ever carried.
   */
  static readonly GRAPH_EVENT_LIMIT = 200;

  /**
   * Record a goal-level lifecycle transition as an event.
   *
   * `goal_events` carries `entity_type = 'goal'` and the lifecycle event types
   * (`activated`, `resolved`, `rejected`, `retired`) for exactly this, but no
   * writer used them — a goal's planning → running → paused → achieved moves
   * were invisible on its own timeline, only node transitions ever got one.
   * Called alongside the row update in `GoalService.transitionStatus`; kept
   * separate because the `goals` row update lives on `GoalModel` and must not
   * depend on this model's actor.
   */
  recordGoalStatus = async (
    goalId: string,
    from: GoalStatus,
    to: GoalStatus,
    reason?: string,
  ): Promise<void> => {
    if (from === to) return;
    const eventType: GoalEventType =
      to === 'running'
        ? 'activated'
        : to === 'achieved'
          ? 'resolved'
          : to === 'failed' || to === 'canceled'
            ? 'rejected'
            : 'updated';
    await this.db.insert(goalEvents).values({
      actorId: this.actor?.id ?? this.userId,
      actorType: this.actor?.type ?? 'user',
      entityId: goalId,
      entityType: 'goal',
      eventType,
      goalId,
      reason: reason ?? `status ${from} → ${to}`,
    });
  };

  /**
   * Record a change to the goal row itself that is not a status move, such as
   * binding it to a topic, so the goal's timeline says when and by whom
   * its carrier changed.
   */
  recordGoalUpdate = async (
    goalId: string,
    input: { operationId?: string; reason: string },
  ): Promise<void> => {
    await this.db.insert(goalEvents).values({
      actorId: this.actor?.id ?? this.userId,
      actorType: this.actor?.type ?? 'user',
      entityId: goalId,
      entityType: 'goal',
      eventType: 'updated',
      goalId,
      operationId: input.operationId,
      reason: input.reason,
    });
  };

  attachWorkVersion = async (
    goalId: string,
    nodeId: string,
    workVersionId: string,
    relation: GoalNodeWorkVersionRelation,
  ) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [node] = await tx
        .select({ id: goalNodes.id })
        .from(goalNodes)
        .where(and(eq(goalNodes.goalId, goalId), eq(goalNodes.id, nodeId)))
        .limit(1);
      if (!node) return undefined;
      const [ownedVersion] = await tx
        .select({ id: workVersions.id })
        .from(workVersions)
        .innerJoin(works, eq(workVersions.workId, works.id))
        .where(
          and(
            eq(workVersions.id, workVersionId),
            workOwnership({
              db: this.db,
              userId: this.userId,
              workspaceId: this.workspaceId,
            }),
          ),
        )
        .limit(1);
      if (!ownedVersion) return undefined;
      const [link] = await tx
        .insert(goalNodeWorkVersions)
        .values({ nodeId, relation, workVersionId })
        .onConflictDoNothing()
        .returning();
      if (!link) return undefined;
      await this.appendEvent(tx, goalId, {
        entityId: nodeId,
        entityType: 'node',
        eventType: 'updated',
        reason: `Attached Work version ${workVersionId} as ${relation}`,
      });
      return link;
    });

  /**
   * Work ids this goal already declares as produced, on any node.
   *
   * The claim predicate for deliverables: one Work is one deliverable, and it
   * belongs to the node that first delivered it. A later round that merely
   * revises the same resource (a shared document every task appends to is the
   * common case) must not re-declare it on its own node, or the goal history
   * repeats one deliverable under every task and its Works list counts one
   * artifact several times.
   *
   * Read from the database rather than from a graph snapshot because the
   * harvest of one settle has to see the links an earlier settle — possibly in
   * the same tick — already wrote. Ticks of one goal are serialized by the
   * dispatch advisory lock, so this read-then-write needs no extra guard.
   */
  listProducedWorkIds = async (goalId: string): Promise<Set<string>> => {
    const rows = await this.db
      .select({ workId: workVersions.workId })
      .from(goalNodeWorkVersions)
      .innerJoin(goalNodes, eq(goalNodeWorkVersions.nodeId, goalNodes.id))
      .innerJoin(workVersions, eq(goalNodeWorkVersions.workVersionId, workVersions.id))
      .where(and(eq(goalNodes.goalId, goalId), eq(goalNodeWorkVersions.relation, 'produced')));

    return new Set(rows.map((row) => row.workId));
  };

  /**
   * How many of a goal's tasks are occupying a concurrency slot.
   *
   * Counted in the database rather than from a graph snapshot so it can be read
   * inside the same transaction as the dispatch claim — two advances that each
   * counted from their own snapshot would both see room and both start work.
   */
  countRunningTasks = async (goalId: string): Promise<number> => {
    const [row] = await this.db
      .select({ count: count() })
      .from(goalNodes)
      .innerJoin(tasks, eq(goalNodes.taskId, tasks.id))
      .where(
        and(
          eq(goalNodes.goalId, goalId),
          eq(goalNodes.kind, 'task'),
          inArray(tasks.status, ['running', 'scheduled']),
          notTrashed(tasks.isDeleted),
        ),
      );
    return row?.count ?? 0;
  };

  /**
   * The goal a task belongs to — as the responsible Task of one of its nodes,
   * as the goal's own execution carrier, or through the nearest ancestor that is
   * either (goal Tasks spawn their own subtasks). Lets a Task page link back to
   * the goal that owns it.
   */
  findGoalByTaskId = async (taskId: string): Promise<{ id: string; title: string } | undefined> => {
    // Walk up `parent_task_id`, nearest first. The task tree has no depth limit,
    // so stop on a revisited id instead of a fixed depth: a corrupt cycle ends
    // without truncating a valid deep chain.
    const chain = await this.db.execute<{ depth: number; id: string }>(sql`
      WITH RECURSIVE chain(id, depth, visited) AS (
        SELECT ${tasks.id}, 0, ARRAY[${tasks.id}] FROM ${tasks} WHERE ${tasks.id} = ${taskId}
        UNION ALL
        SELECT ${tasks.parentTaskId}, chain.depth + 1, chain.visited || ${tasks.parentTaskId}
        FROM ${tasks} JOIN chain ON ${tasks.id} = chain.id
        WHERE ${tasks.parentTaskId} IS NOT NULL
          AND NOT (${tasks.parentTaskId} = ANY(chain.visited))
      )
      SELECT id, depth FROM chain
    `);
    const depthOf = new Map(chain.rows.map((row) => [row.id, Number(row.depth)]));
    if (depthOf.size === 0) return undefined;
    const taskIds = [...depthOf.keys()];

    const rows = await this.db
      .select({
        carrierTaskId: goals.subjectId,
        createdAt: goals.createdAt,
        id: goals.id,
        nodeTaskId: goalNodes.taskId,
        subjectType: goals.subjectType,
        title: goals.title,
      })
      .from(goals)
      .leftJoin(goalNodes, and(eq(goalNodes.goalId, goals.id), inArray(goalNodes.taskId, taskIds)))
      .where(
        and(
          this.ownership(),
          or(
            inArray(goalNodes.taskId, taskIds),
            and(eq(goals.subjectType, 'task'), inArray(goals.subjectId, taskIds)),
          ),
        ),
      );

    const depthOfRow = (row: (typeof rows)[number]) =>
      Math.min(
        row.nodeTaskId ? (depthOf.get(row.nodeTaskId) ?? Infinity) : Infinity,
        row.subjectType === 'task' && row.carrierTaskId
          ? (depthOf.get(row.carrierTaskId) ?? Infinity)
          : Infinity,
      );
    const [nearest] = rows.sort(
      (a, b) =>
        depthOfRow(a) - depthOfRow(b) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return nearest ? { id: nearest.id, title: nearest.title } : undefined;
  };

  createNode = async (goalId: string, input: CreateNodeInput) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const { scopeId, questionId, ...values } = input;
      if (input.kind === 'experiment' && !questionId)
        throw new Error('An experiment must answer a question');
      if (input.kind !== 'experiment' && questionId)
        throw new Error('Only experiments can answer questions');
      const [node] = await tx
        .insert(goalNodes)
        .values({
          ...values,
          confidence: input.confidence?.toString(),
          createdByUserId: input.createdByAgentId ? undefined : this.userId,
          goalId,
        })
        .returning();
      await this.appendEvent(tx, goalId, {
        actorId: input.createdByAgentId,
        actorType: input.createdByAgentId ? 'agent' : undefined,
        entityId: node.id,
        entityType: 'node',
        eventType: 'created',
      });
      const model = new GoalGraphModel(
        tx as unknown as LobeChatDatabase,
        this.userId,
        this.workspaceId,
        this.actor,
      );
      if (scopeId) await model.createEdge(goalId, scopeId, node.id, 'contains');
      if (questionId) await model.createEdge(goalId, node.id, questionId, 'answers');
      return node;
    });

  /** Serialize synthesized-node creation by semantic identity within one Goal. */
  createNodeOnce = async (goalId: string, input: CreateNodeInput) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`goal-node:${goalId}:${input.kind}:${input.title}`}))`,
      );
      const [existing] = await tx
        .select()
        .from(goalNodes)
        .where(
          and(
            eq(goalNodes.goalId, goalId),
            eq(goalNodes.kind, input.kind),
            eq(goalNodes.title, input.title),
          ),
        )
        .limit(1);
      if (existing) return { created: false, node: existing };

      const [node] = await tx
        .insert(goalNodes)
        .values({
          ...input,
          confidence: input.confidence?.toString(),
          createdByUserId: input.createdByAgentId ? undefined : this.userId,
          goalId,
        })
        .returning();
      await this.appendEvent(tx, goalId, {
        actorId: input.createdByAgentId,
        actorType: input.createdByAgentId ? 'agent' : undefined,
        entityId: node.id,
        entityType: 'node',
        eventType: 'created',
      });
      return { created: true, node };
    });

  createEdge = async (
    goalId: string,
    sourceNodeId: string,
    targetNodeId: string,
    kind: GoalEdgeKind,
  ) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      if (kind === 'contains' || kind === 'answers') {
        const nodes = await tx.select().from(goalNodes).where(eq(goalNodes.goalId, goalId));
        const edges = await tx.select().from(goalEdges).where(eq(goalEdges.goalId, goalId));
        const graph = { nodes, edges };
        const source = nodes.find((node) => node.id === sourceNodeId);
        const target = nodes.find((node) => node.id === targetNodeId);
        if (!source || !target || source.id === target.id)
          throw new Error('Invalid experiment relationship');
        // Two kinds are containers: an `experiment` (a candidate answer under
        // test) and a `batch` (one repeated mould delivered as a class). The
        // single-owner and cycle rules below are about containment itself, so
        // they hold for both; only the question-scope rules are experiment-only.
        if (source.kind !== 'experiment' && source.kind !== 'batch')
          throw new Error('Only a container can contain nodes or answer a question');
        if (kind === 'answers' && source.kind !== 'experiment')
          throw new Error('Only an experiment can answer a question');
        if (kind === 'contains') {
          const owner = experimentOwner(graph, target.id);
          if (owner && owner !== source.id)
            throw new Error('A node can belong to only one experiment');
          if (experimentMembers(graph, target.id).has(source.id))
            throw new Error('Experiment containment cannot form a cycle');
          const questionId = edges.find(
            (edge) => edge.kind === 'answers' && edge.sourceNodeId === target.id,
          )?.targetNodeId;
          if (
            source.kind === 'experiment' &&
            edges.some(
              (edge) =>
                edge.kind === 'answers' &&
                edge.targetNodeId === target.id &&
                experimentOwner(graph, edge.sourceNodeId) !== source.id,
            )
          )
            throw new Error('A question must share its answer scope');
          if (
            source.kind === 'experiment' &&
            questionId &&
            experimentOwner(graph, questionId) !== source.id
          )
            throw new Error('An answer must share its question scope');
        } else {
          if (target.kind !== 'problem') throw new Error('An experiment must answer a question');
          if (experimentOwner(graph, source.id) !== experimentOwner(graph, target.id))
            throw new Error('An answer must share its question scope');
          if (
            edges.some(
              (edge) =>
                edge.kind === 'answers' &&
                edge.sourceNodeId === source.id &&
                edge.targetNodeId !== target.id,
            )
          )
            throw new Error('An experiment answers one question');
        }
      }
      const [edge] = await tx
        .insert(goalEdges)
        .values({ goalId, kind, sourceNodeId, targetNodeId })
        .returning();
      await this.appendEvent(tx, goalId, {
        entityId: edge.id,
        entityType: 'edge',
        eventType: 'linked',
      });
      return edge;
    });

  bindTask = async (goalId: string, nodeId: string, taskId: string) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [node] = await tx
        .update(goalNodes)
        .set({ status: 'active', taskId, updatedAt: new Date() })
        .where(
          and(
            eq(goalNodes.goalId, goalId),
            eq(goalNodes.id, nodeId),
            eq(goalNodes.kind, 'task'),
            // A node retired (or otherwise settled) while its Task was being
            // created must not be flipped back to `active` by the bind — that
            // is the fence `GoalService.retireNodes` relies on.
            notInArray(goalNodes.status, ['resolved', 'rejected', 'retired']),
            isNull(goalNodes.taskId),
          ),
        )
        .returning();
      if (!node) return undefined;
      await this.appendEvent(tx, goalId, {
        entityId: taskId,
        entityType: 'task',
        eventType: 'linked',
        taskId,
      });
      return node;
    });

  claimTaskNode = async (goalId: string, nodeId: string, staleBefore: Date) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [node] = await tx
        .update(goalNodes)
        .set({ status: 'active', updatedAt: new Date() })
        .where(
          and(
            eq(goalNodes.goalId, goalId),
            eq(goalNodes.id, nodeId),
            eq(goalNodes.kind, 'task'),
            or(
              eq(goalNodes.status, 'proposed'),
              and(eq(goalNodes.status, 'active'), lt(goalNodes.updatedAt, staleBefore)),
            ),
            isNull(goalNodes.taskId),
          ),
        )
        .returning();
      if (!node) return undefined;
      await this.appendEvent(tx, goalId, {
        entityId: node.id,
        entityType: 'node',
        eventType: 'activated',
      });
      return node;
    });

  /** Rewrite a node's description — e.g. the planner replacing the seeded requirement blob with its own problem statement. */
  /** `confidence` travels with the description when the planner re-reads the problem. */
  updateNodeDescription = async (
    goalId: string,
    nodeId: string,
    description: string,
    confidence?: number,
  ) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [node] = await tx
        .update(goalNodes)
        .set({
          description,
          ...(confidence === undefined ? {} : { confidence: confidence.toString() }),
          updatedAt: new Date(),
        })
        .where(and(eq(goalNodes.goalId, goalId), eq(goalNodes.id, nodeId)))
        .returning();
      if (!node) return undefined;
      await this.appendEvent(tx, goalId, {
        entityId: node.id,
        entityType: 'node',
        eventType: 'updated',
        reason: 'Planner refined the description',
        taskId: node.taskId ?? undefined,
      });
      return node;
    });

  /** Current status of one node, read fresh — for writers holding an older snapshot. */
  getNodeStatus = async (goalId: string, nodeId: string): Promise<GoalNodeStatus | undefined> => {
    const [row] = await this.db
      .select({ status: goalNodes.status })
      .from(goalNodes)
      .innerJoin(goals, eq(goals.id, goalNodes.goalId))
      .where(and(eq(goalNodes.goalId, goalId), eq(goalNodes.id, nodeId), this.ownership()))
      .limit(1);
    return row?.status as GoalNodeStatus | undefined;
  };

  updateNodeStatus = async (
    goalId: string,
    nodeId: string,
    status: GoalNodeStatus,
    reason?: string,
  ) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [node] = await tx
        .update(goalNodes)
        .set({
          resolvedAt: status === 'resolved' ? new Date() : null,
          status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(goalNodes.goalId, goalId),
            eq(goalNodes.id, nodeId),
            // Retirement is a person's final word on a node. A coordinator tick
            // that loaded the node before it was retired must not write it back
            // to `resolved` / `active` afterwards; the goal row lock taken above
            // serializes this check with the retirement itself.
            status === 'retired' ? undefined : ne(goalNodes.status, 'retired'),
          ),
        )
        .returning();
      if (!node) return undefined;
      const eventType: GoalEventType =
        status === 'active'
          ? 'activated'
          : status === 'resolved'
            ? 'resolved'
            : status === 'rejected'
              ? 'rejected'
              : status === 'retired'
                ? 'retired'
                : 'updated';
      await this.appendEvent(tx, goalId, {
        entityId: node.id,
        entityType: 'node',
        eventType,
        reason,
        taskId: node.taskId ?? undefined,
      });
      return node;
    });

  createDecision = async (goalId: string, nodeId: string, input: CreateDecisionInput) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [node] = await tx
        .select()
        .from(goalNodes)
        .where(
          and(
            eq(goalNodes.goalId, goalId),
            eq(goalNodes.id, nodeId),
            eq(goalNodes.kind, 'decision'),
          ),
        )
        .limit(1);
      if (!node) return undefined;
      const [decision] = await tx
        .insert(goalNodeDecisions)
        .values({ ...input, nodeId })
        .returning();
      await this.appendEvent(tx, goalId, {
        entityId: decision.id,
        entityType: 'decision',
        eventType: 'created',
      });
      return decision;
    });

  resolveDecision = async (
    goalId: string,
    decisionId: string,
    optionId: string,
    resolution?: string,
  ) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [ownedDecision] = await tx
        .select({ id: goalNodeDecisions.id })
        .from(goalNodeDecisions)
        .innerJoin(goalNodes, eq(goalNodeDecisions.nodeId, goalNodes.id))
        .where(
          and(
            eq(goalNodeDecisions.id, decisionId),
            eq(goalNodeDecisions.status, 'pending'),
            eq(goalNodes.goalId, goalId),
          ),
        )
        .limit(1);
      if (!ownedDecision) return undefined;
      const [decision] = await tx
        .update(goalNodeDecisions)
        .set({
          resolution,
          resolvedAt: new Date(),
          resolvedByUserId: this.userId,
          resolvedOptionId: optionId,
          status: 'resolved',
          updatedAt: new Date(),
        })
        .where(
          and(eq(goalNodeDecisions.id, ownedDecision.id), eq(goalNodeDecisions.status, 'pending')),
        )
        .returning();
      if (!decision) return undefined;
      await tx
        .update(goalNodes)
        .set({ resolvedAt: new Date(), status: 'resolved', updatedAt: new Date() })
        .where(eq(goalNodes.id, decision.nodeId));
      await this.appendEvent(tx, goalId, {
        entityId: decision.id,
        entityType: 'decision',
        eventType: 'resolved',
        reason: resolution,
      });
      await settleDecisionBriefs(tx, decision.id, optionId, resolution);
      return decision;
    });

  /**
   * Cancel a still-pending decision whose question a later action made moot —
   * nobody picked an option, so this is distinct from `resolveDecision`. The
   * decision node retires with it; a canceled gate must not keep parking the
   * goal on the pending-decision branch.
   */
  cancelDecision = async (goalId: string, decisionId: string, reason?: string) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
      const [ownedDecision] = await tx
        .select({ id: goalNodeDecisions.id })
        .from(goalNodeDecisions)
        .innerJoin(goalNodes, eq(goalNodeDecisions.nodeId, goalNodes.id))
        .where(
          and(
            eq(goalNodeDecisions.id, decisionId),
            eq(goalNodeDecisions.status, 'pending'),
            eq(goalNodes.goalId, goalId),
          ),
        )
        .limit(1);
      if (!ownedDecision) return undefined;
      const [decision] = await tx
        .update(goalNodeDecisions)
        .set({ canceledAt: new Date(), status: 'canceled', updatedAt: new Date() })
        .where(
          and(eq(goalNodeDecisions.id, ownedDecision.id), eq(goalNodeDecisions.status, 'pending')),
        )
        .returning();
      if (!decision) return undefined;
      await tx
        .update(goalNodes)
        .set({ status: 'retired', updatedAt: new Date() })
        .where(eq(goalNodes.id, decision.nodeId));
      await this.appendEvent(tx, goalId, {
        entityId: decision.id,
        entityType: 'decision',
        eventType: 'retired',
        reason,
      });
      await settleDecisionBriefs(tx, decision.id, 'canceled', reason);
      return decision;
    });
}
