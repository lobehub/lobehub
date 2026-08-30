import type {
  GoalDecisionAuthority,
  GoalDecisionOption,
  GoalEdgeKind,
  GoalEventActor,
  GoalEventActorType,
  GoalEventEntityType,
  GoalEventType,
  GoalGraphSnapshot,
  GoalNodeKind,
  GoalNodeStatus,
  GoalNodeWorkVersionRelation,
} from '@lobechat/types';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { goals } from '../schemas/goal';
import {
  goalEdges,
  goalEvents,
  goalNodeDecisions,
  goalNodes,
  goalNodeWorkVersions,
} from '../schemas/goalGraph';
import { works, workVersions } from '../schemas/work';
import type { LobeChatDatabase, Transaction } from '../type';
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
      .limit(1);
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
    const goal = await this.ownedGoal(goalId);
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
        .orderBy(asc(goalEvents.createdAt)),
      this.db
        .select({ link: goalNodeWorkVersions })
        .from(goalNodeWorkVersions)
        .innerJoin(goalNodes, eq(goalNodeWorkVersions.nodeId, goalNodes.id))
        .where(eq(goalNodes.goalId, goalId))
        .orderBy(asc(goalNodeWorkVersions.createdAt)),
    ]);

    return {
      decisions: decisions.map(({ goal_node_decisions }) => goal_node_decisions),
      edges,
      events,
      goal,
      nodes,
      workVersions: linkedWorkVersions.map(({ link }) => link),
    };
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

  createNode = async (goalId: string, input: CreateNodeInput) =>
    this.db.transaction(async (tx) => {
      if (!(await this.ownedGoal(goalId, tx))) return undefined;
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
        .where(and(eq(goalNodes.goalId, goalId), eq(goalNodes.id, nodeId)))
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
      return decision;
    });
}
