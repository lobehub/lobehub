import { randomUUID } from 'node:crypto';

import { type McpInvocationIdentity, mcpInvocationKey } from '@lobechat/mcp-elicitation/transport';
import type { PendingMcpElicitation } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';
import { and, asc, eq, gt, inArray, ne, notInArray, sql } from 'drizzle-orm';

import {
  agentInterventionResolutions,
  agentInterventions,
  agentOperations,
  messagePlugins,
  messages,
} from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/** MCP dispatch markers live on the existing durable operation, beside intervention recovery. */
export class McpInvocationModel {
  constructor(
    readonly db: LobeChatDatabase,
    readonly userId: string,
    readonly workspaceId?: string,
  ) {}

  /** Queries remain inspectable with toSQL() for real PostgreSQL plan verification. */
  static recoveryQueries(db: LobeChatDatabase, now = Date.now()) {
    const interactions = db
      .select({
        itemId: agentInterventions.id,
        deadline: agentInterventions.deadline,
        userId: agentInterventions.userId,
        workspaceId: agentInterventions.workspaceId,
        operationId: agentInterventions.operationId,
      })
      .from(agentInterventions)
      .innerJoin(messagePlugins, eq(messagePlugins.id, agentInterventions.toolMessageId))
      .innerJoin(messages, eq(messages.id, agentInterventions.toolMessageId))
      .innerJoin(agentOperations, eq(agentOperations.id, agentInterventions.operationId))
      .leftJoin(
        agentInterventionResolutions,
        eq(agentInterventionResolutions.id, agentInterventions.resolutionId),
      )
      .where(
        and(
          eq(agentInterventions.source, 'mcp'),
          inArray(agentInterventions.status, [
            'pending',
            'resolving',
            'timed_out',
            'session_ended',
          ]),
          notInArray(agentOperations.status, ['done', 'error', 'interrupted', 'abandoned']),
          eq(agentOperations.userId, agentInterventions.userId),
          eq(messages.userId, agentInterventions.userId),
          eq(messagePlugins.userId, agentInterventions.userId),
          sql`${agentOperations.workspaceId} IS NOT DISTINCT FROM ${agentInterventions.workspaceId}`,
          sql`${messages.workspaceId} IS NOT DISTINCT FROM ${agentInterventions.workspaceId}`,
          sql`${messagePlugins.workspaceId} IS NOT DISTINCT FROM ${agentInterventions.workspaceId}`,
          sql`${messagePlugins.intervention}->>'status' = 'pending'`,
          sql`${messagePlugins.intervention}->>'batchId' = ${agentInterventions.batchId}`,
          sql`${messagePlugins.intervention}->>'operationId' = ${agentInterventions.operationId}`,
          sql`${messagePlugins.state} #>> '{mcpElicitation,batchId}' = ${agentInterventions.batchId}`,
          sql`coalesce((${agentOperations.metadata}->'mcpRecoveryClaims'->>(${agentInterventions.id})::text)::bigint,0) <= ${now}`,
          sql`((${agentInterventions.status} <> 'resolving' AND ${agentInterventions.deadline} <= ${new Date(now)}) OR (
          ${agentInterventions.status} = 'resolving'
          AND ${agentInterventionResolutions.source} = 'mcp'
          AND ${agentInterventionResolutions.status} = 'resolving'
          AND ${agentInterventionResolutions.userId} = ${agentInterventions.userId}
          AND ${agentInterventionResolutions.workspaceId} IS NOT DISTINCT FROM ${agentInterventions.workspaceId}
          AND ${agentInterventionResolutions.batchId} = ${agentInterventions.batchId}
          AND ${agentInterventionResolutions.operationId} = ${agentInterventions.operationId}
          AND coalesce(${messagePlugins.state} #>> '{mcpElicitation,legacy}', 'false') <> 'true'
          AND (${agentInterventionResolutions.customExecutionState} IS DISTINCT FROM 'executing' OR ${agentInterventionResolutions.customExecutionLeaseExpiresAt} <= ${new Date(now)})
          AND coalesce((${agentOperations.metadata}->'mcpResumeDispatch'->(${agentInterventionResolutions.resolutionRequestId})::text->>'leaseUntil')::bigint,0) <= ${now}
        ))`,
        ),
      )
      // A failed/protected row gets a durable cooldown and moves behind untouched work.
      .orderBy(
        sql`coalesce((${agentOperations.metadata}->'mcpRecoveryClaims'->>(${agentInterventions.id})::text)::bigint,0)`,
        asc(agentInterventions.deadline),
        asc(agentInterventions.id),
      )
      .limit(32);
    const clients = db
      .select({
        operationId: agentOperations.id,
        userId: agentOperations.userId,
        workspaceId: agentOperations.workspaceId,
      })
      .from(agentOperations)
      .where(
        and(
          // jsonb_ops GIN supports ?, unlike metadata->key IS NOT NULL. See EXPLAIN evidence.
          sql`${agentOperations.metadata} ? 'clientMcpStep'`,
          inArray(agentOperations.status, ['running', 'waiting_for_client']),
          sql`coalesce(${agentOperations.metadata}->>'mcpClientExpiryFinished','false') <> 'true'`,
          sql`coalesce((${agentOperations.metadata}->>'mcpClientRecoveryUntil')::bigint,0) <= ${now}`,
          sql`(((${agentOperations.metadata} #>> '{clientMcpStep,deadline}')::bigint + 60000 <= ${now}
        AND coalesce((${agentOperations.metadata} #>> '{clientMcpStep,leaseUntil}')::bigint,0) <= ${now}) OR EXISTS (
        SELECT 1 FROM jsonb_each(coalesce(${agentOperations.metadata}->'mcpClientQueue','{}'::jsonb)) AS entry(key,value)
        WHERE (entry.value->>'leaseUntil')::bigint <= ${now}
        AND NOT (coalesce(${agentOperations.metadata}->'mcpClientWire','{}'::jsonb) ? entry.key)
      ))`,
        ),
      )
      .orderBy(
        sql`coalesce((${agentOperations.metadata}->>'mcpClientRecoveryUntil')::bigint,0)`,
        asc(agentOperations.createdAt),
        asc(agentOperations.id),
      )
      .limit(32);
    return { interactions, clients };
  }

  /** Bounded, fair, multi-worker claims. No response values or process-local cursors. */
  static async recoveryWork(db: LobeChatDatabase, now = Date.now()) {
    const queries = this.recoveryQueries(db, now);
    const [interactions, clients] = await Promise.all([queries.interactions, queries.clients]);
    const claimedInteractions: typeof interactions = [];
    const claimedClients: typeof clients = [];
    for (const [rows, client] of [
      [interactions, false],
      [clients, true],
    ] as const) {
      for (const row of rows) {
        const claimed = await db.transaction(async (tx) => {
          const [op] = await tx
            .select({ metadata: agentOperations.metadata, status: agentOperations.status })
            .from(agentOperations)
            .where(eq(agentOperations.id, row.operationId))
            .for('update');
          const allowedStatuses = client
            ? ['running', 'waiting_for_client']
            : ['running', 'waiting_for_client', 'waiting_for_async_tool'];
          if (!op || !allowedStatuses.includes(op.status)) return false;
          const claims = toRecord(op.metadata?.mcpRecoveryClaims) ?? {};
          const itemId = 'itemId' in row ? row.itemId : '';
          if (Number(client ? op.metadata?.mcpClientRecoveryUntil : claims[itemId]) > now)
            return false;
          const patch = client
            ? { mcpClientRecoveryUntil: now + 15000 }
            : { mcpRecoveryClaims: { ...claims, [itemId]: now + 15000 } };
          await tx
            .update(agentOperations)
            .set({
              metadata: sql`coalesce(${agentOperations.metadata},'{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
            })
            .where(eq(agentOperations.id, row.operationId));
          return true;
        });
        if (claimed) {
          if (client) claimedClients.push(row);
          else if ('itemId' in row) claimedInteractions.push(row);
        }
      }
    }
    return { interactions: claimedInteractions, clients: claimedClients };
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentOperations);

  /** Only open MCP rows and their public projection; never scan or fetch historical plugin JSON. */
  async listPending(topicId: string, threadId?: string | null): Promise<PendingMcpElicitation[]> {
    const rows = await this.db
      .select({
        id: agentInterventions.id,
        batchId: agentInterventions.batchId,
        deadline: agentInterventions.deadline,
        status: agentInterventions.status,
        operationId: agentInterventions.operationId,
        detail: agentInterventions.sanitizedRequest,
        assistantMessageId: messages.parentId,
        toolMessageId: messages.id,
        identifier: messagePlugins.identifier,
        apiName: messagePlugins.apiName,
        toolCallId: messagePlugins.toolCallId,
      })
      .from(agentInterventions)
      .innerJoin(agentOperations, eq(agentOperations.id, agentInterventions.operationId))
      .innerJoin(messages, eq(messages.id, agentInterventions.toolMessageId))
      .innerJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .where(
        and(
          this.ownership(),
          eq(agentInterventions.userId, this.userId),
          sql`${agentInterventions.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          eq(messages.userId, this.userId),
          eq(messagePlugins.userId, this.userId),
          sql`${messages.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          sql`${messagePlugins.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          eq(messages.topicId, topicId),
          sql`${messages.threadId} IS NOT DISTINCT FROM ${threadId ?? null}`,
          eq(agentInterventions.source, 'mcp'),
          inArray(agentInterventions.status, ['pending', 'resolving']),
          gt(agentInterventions.deadline, new Date()),
          notInArray(agentOperations.status, ['done', 'error', 'interrupted', 'abandoned']),
          sql`${messagePlugins.intervention}->>'status' = 'pending'`,
          sql`${messagePlugins.intervention}->>'batchId' = ${agentInterventions.batchId}`,
        ),
      )
      .orderBy(asc(agentInterventions.createdAt), asc(agentInterventions.id))
      .limit(32);
    return rows.flatMap((row) => {
      const detail = row.detail.customDetail;
      if (
        detail?.kind !== 'mcp_elicitation' ||
        !row.assistantMessageId ||
        !row.identifier ||
        !row.apiName ||
        !row.toolCallId
      )
        return [];
      return [
        {
          ...row,
          detail: undefined,
          status: undefined,
          deadline: row.deadline.getTime(),
          resolving: row.status === 'resolving',
          assistantMessageId: row.assistantMessageId,
          identifier: row.identifier,
          apiName: row.apiName,
          toolCallId: row.toolCallId,
          serverName: detail.serverName,
          requests: JSON.parse(detail.requests),
        },
      ];
    });
  }

  async claimDispatch(operationId: string, resolutionRequestId: string, now = Date.now()) {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({ metadata: agentOperations.metadata, status: agentOperations.status })
        .from(agentOperations)
        .where(and(eq(agentOperations.id, operationId), this.ownership()))
        .for('update');
      if (!operation || ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status))
        return;
      const [resolution] = await tx
        .select({
          state: agentInterventionResolutions.customExecutionState,
          leaseExpiresAt: agentInterventionResolutions.customExecutionLeaseExpiresAt,
        })
        .from(agentInterventionResolutions)
        .where(
          and(
            eq(agentInterventionResolutions.operationId, operationId),
            eq(agentInterventionResolutions.resolutionRequestId, resolutionRequestId),
            eq(agentInterventionResolutions.userId, this.userId),
            sql`${agentInterventionResolutions.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
            eq(agentInterventionResolutions.source, 'mcp'),
            eq(agentInterventionResolutions.status, 'resolving'),
          ),
        )
        .for('update');
      if (
        !resolution ||
        (resolution.state === 'executing' &&
          resolution.leaseExpiresAt &&
          resolution.leaseExpiresAt.getTime() > now)
      )
        return;
      const markers = toRecord(operation.metadata?.mcpResumeDispatch) ?? {};
      const previous = toRecord(markers[resolutionRequestId]);
      if (typeof previous?.leaseUntil === 'number' && previous.leaseUntil > now) return;
      const marker = { token: randomUUID(), leaseUntil: now + 15_000, state: 'scheduling' };
      await tx
        .update(agentOperations)
        .set({
          metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({ mcpResumeDispatch: { ...markers, [resolutionRequestId]: marker } })}::jsonb`,
        })
        .where(and(eq(agentOperations.id, operationId), this.ownership()));
      return marker.token;
    });
  }

  async acknowledgeDispatch(
    operationId: string,
    resolutionRequestId: string,
    token: string,
    messageId: string,
    now = Date.now(),
  ) {
    return this.db.transaction(async (tx) => {
      const [operation] = await tx
        .select({ metadata: agentOperations.metadata })
        .from(agentOperations)
        .where(and(eq(agentOperations.id, operationId), this.ownership()))
        .for('update');
      const markers = toRecord(operation?.metadata?.mcpResumeDispatch) ?? {};
      if (toRecord(markers[resolutionRequestId])?.token !== token) return false;
      const marker = { token, messageId, state: 'scheduled', leaseUntil: now + 45_000 };
      await tx
        .update(agentOperations)
        .set({
          metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({ mcpResumeDispatch: { ...markers, [resolutionRequestId]: marker } })}::jsonb`,
        })
        .where(and(eq(agentOperations.id, operationId), this.ownership()));
      return true;
    });
  }

  async markClientWaiting(operationId: string) {
    await this.db
      .update(agentOperations)
      .set({ status: 'waiting_for_client' })
      .where(
        and(
          this.ownership(),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.id, operationId),
          eq(agentOperations.status, 'running'),
          sql`${agentOperations.metadata} ? 'clientMcpStep'`,
        ),
      );
  }

  /** Explicit user abort retires this owner; closing a page only expires its lease. */
  async cancelClientStep(operationId: string, owner: string) {
    const [row] = await this.db
      .update(agentOperations)
      .set({
        status: 'interrupted',
        completedAt: new Date(),
        completionReason: 'interrupted',
      })
      .where(
        and(
          this.ownership(),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.id, operationId),
          inArray(agentOperations.status, ['running', 'waiting_for_client']),
          sql`${agentOperations.metadata} #>> '{clientMcpStep,owner}' = ${owner}`,
        ),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  /** Durable producer ownership survives cache expiry and a native process restart. */
  async claimProducer(
    identity: McpInvocationIdentity,
    producerId: string,
    fingerprint: string,
    deadline: number,
  ) {
    if (
      identity.userId !== this.userId ||
      identity.workspaceId !== this.workspaceId ||
      deadline <= Date.now()
    )
      return false;
    const key = mcpInvocationKey(identity);
    return this.db.transaction(async (tx) => {
      const [op] = await tx
        .select({ metadata: agentOperations.metadata, status: agentOperations.status })
        .from(agentOperations)
        .where(
          and(
            this.ownership(),
            eq(agentOperations.userId, this.userId),
            eq(agentOperations.id, identity.operationId),
          ),
        )
        .for('update');
      if (!op || ['done', 'error', 'interrupted', 'abandoned'].includes(op.status)) return false;
      const claims = toRecord(op.metadata?.mcpProducerClaims) ?? {};
      const previous = toRecord(claims[key]);
      if (previous)
        return previous.producerId === producerId && previous.fingerprint === fingerprint;
      await tx
        .update(agentOperations)
        .set({
          metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({ mcpProducerClaims: { ...claims, [key]: { producerId, fingerprint, deadline } } })}::jsonb`,
        })
        .where(
          and(
            this.ownership(),
            eq(agentOperations.userId, this.userId),
            eq(agentOperations.id, identity.operationId),
          ),
        );
      return true;
    });
  }

  async claimClientDispatch(
    operationId: string,
    identity: { toolMessageId?: string; [key: string]: unknown },
    now = Date.now(),
  ) {
    const toolMessageId = identity.toolMessageId;
    if (!toolMessageId) throw new Error('Client MCP tool row is required');
    return this.db.transaction(async (tx) => {
      const [op] = await tx
        .select({ metadata: agentOperations.metadata, status: agentOperations.status })
        .from(agentOperations)
        .where(
          and(
            this.ownership(),
            eq(agentOperations.userId, this.userId),
            eq(agentOperations.id, operationId),
          ),
        )
        .for('update');
      if (!op || !['running', 'waiting_for_client'].includes(op.status)) return false;
      const wire = toRecord(op.metadata?.mcpClientWire) ?? {};
      if (wire[toolMessageId]) return false;
      const queue = toRecord(op.metadata?.mcpClientQueue) ?? {};
      const previous = toRecord(queue[toolMessageId]);
      if (Number(previous?.leaseUntil) > now) return false;
      await tx
        .update(agentOperations)
        .set({
          metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({
            mcpClientQueue: {
              ...queue,
              [toolMessageId]: { identity, leaseUntil: now + 15_000 },
            },
          })}::jsonb`,
        })
        .where(
          and(
            this.ownership(),
            eq(agentOperations.id, operationId),
            eq(agentOperations.userId, this.userId),
          ),
        );
      return true;
    });
  }

  async claimClientWire(operationId: string, toolMessageId: string, leaseUntil?: number) {
    const [row] = await this.db
      .update(agentOperations)
      .set({
        metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || jsonb_build_object('mcpClientWire', coalesce(${agentOperations.metadata}->'mcpClientWire', '{}'::jsonb) || jsonb_build_object(${toolMessageId}::text, ${JSON.stringify({ leaseUntil: leaseUntil ?? Date.now() + 60_000 })}::jsonb))`,
      })
      .where(
        and(
          this.ownership(),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.id, operationId),
          inArray(agentOperations.status, ['running', 'waiting_for_client']),
          sql`${agentOperations.metadata} ? 'clientMcpStep'`,
          sql`NOT coalesce(${agentOperations.metadata}->'mcpClientWire', '{}'::jsonb) ? ${toolMessageId}`,
        ),
      )
      .returning({ id: agentOperations.id });
    return Boolean(row);
  }

  async clientSteps(topicId: string, threadId?: string | null) {
    return this.db
      .select({
        operationId: agentOperations.id,
        workspaceId: agentOperations.workspaceId,
        model: agentOperations.model,
        provider: agentOperations.provider,
        agentId: agentOperations.agentId,
        topicId: agentOperations.topicId,
        threadId: agentOperations.threadId,
        step: sql<Record<string, unknown>>`${agentOperations.metadata}->'clientMcpStep'`,
      })
      .from(agentOperations)
      .where(
        and(
          this.ownership(),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.topicId, topicId),
          sql`${agentOperations.threadId} IS NOT DISTINCT FROM ${threadId ?? null}`,
          inArray(agentOperations.status, ['running', 'waiting_for_client']),
          sql`${agentOperations.metadata} ? 'clientMcpStep'`,
        ),
      )
      .orderBy(asc(agentOperations.createdAt))
      .limit(16);
  }

  async leaseClientStep(operationId: string, owner: string, finish = false) {
    return this.db.transaction(async (tx) => {
      const [op] = await tx
        .select()
        .from(agentOperations)
        .where(
          and(
            this.ownership(),
            eq(agentOperations.userId, this.userId),
            eq(agentOperations.id, operationId),
          ),
        )
        .for('update');
      const step = toRecord(op?.metadata?.clientMcpStep);
      if (
        !op ||
        !['running', 'waiting_for_client'].includes(op.status) ||
        !step ||
        !Array.isArray(step.toolMessageIds)
      )
        return;
      const sameOwner = step.owner === owner;
      if (!sameOwner && Number(step.leaseUntil) > Date.now()) return;
      const ids = step.toolMessageIds.filter((id): id is string => typeof id === 'string');
      // Approval can partition one assistant into several execution instructions.
      // Lock their shared assistant, wait for ALL original calls, and fence one
      // cold continuation across the resulting durable tool-only anchors.
      const [assistant] = await tx
        .select({ tools: messages.tools })
        .from(messages)
        .where(
          and(
            eq(messages.id, String(step.assistantMessageId)),
            eq(messages.userId, this.userId),
            sql`${messages.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          ),
        )
        .for('update');
      if (!assistant) return;
      const rows = await tx
        .select({
          id: messages.id,
          toolCallId: messagePlugins.toolCallId,
          ready: sql<boolean>`${messages.content} <> '' OR ${messages.error} IS NOT NULL OR ${messagePlugins.error} IS NOT NULL OR coalesce((${messagePlugins.state}->>'mcpClientComplete')::boolean, false)`,
        })
        .from(messages)
        .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
        .where(
          and(
            eq(messages.parentId, String(step.assistantMessageId)),
            eq(messages.role, 'tool'),
            eq(messages.userId, this.userId),
            sql`${messages.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          ),
        )
        .limit(128);
      if (
        !sameOwner &&
        (!Array.isArray(assistant.tools) ||
          assistant.tools.some(
            (call) => !rows.some((row) => row.toolCallId === call.id && row.ready),
          ))
      )
        return;
      if (finish && !sameOwner) return;
      const [nextAssistant] = await tx
        .select({ id: messages.id, content: messages.content, tools: messages.tools })
        .from(messages)
        .where(
          and(
            eq(messages.userId, this.userId),
            sql`${messages.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
            inArray(messages.parentId, [
              ...rows.map((row) => row.id),
              String(step.assistantMessageId),
            ]),
            eq(messages.role, 'assistant'),
          ),
        )
        .orderBy(asc(messages.createdAt))
        .limit(1);
      const parentAdvanced =
        Boolean(nextAssistant?.content) ||
        (Array.isArray(nextAssistant?.tools) && nextAssistant.tools.length > 0);
      if (!sameOwner && !parentAdvanced) {
        // The assistant lock serializes claims across partitioned anchors; the
        // private operation lease remains authoritative, never UI metadata.
        const [liveSibling] = await tx
          .select({ id: agentOperations.id })
          .from(agentOperations)
          .where(
            and(
              this.ownership(),
              eq(agentOperations.userId, this.userId),
              ne(agentOperations.id, operationId),
              eq(agentOperations.topicId, op.topicId!),
              inArray(agentOperations.status, ['running', 'waiting_for_client']),
              sql`${agentOperations.metadata} #>> '{clientMcpStep,assistantMessageId}' = ${String(step.assistantMessageId)}`,
              sql`(${agentOperations.metadata} #>> '{clientMcpStep,leaseUntil}')::bigint > ${Date.now()}`,
            ),
          )
          .limit(1);
        if (liveSibling) return;
      }
      await tx
        .update(agentOperations)
        .set({
          status: finish || (!sameOwner && parentAdvanced) ? 'done' : 'waiting_for_client',
          metadata: sql`coalesce(${agentOperations.metadata}, '{}'::jsonb) || ${JSON.stringify({ clientMcpStep: { ...step, owner, leaseUntil: Date.now() + 45_000 } })}::jsonb`,
        })
        .where(
          and(
            this.ownership(),
            eq(agentOperations.id, operationId),
            eq(agentOperations.userId, this.userId),
          ),
        );
      if (!sameOwner && parentAdvanced) return;
      return {
        operationId,
        workspaceId: op.workspaceId,
        model: op.model,
        provider: op.provider,
        agentId: op.agentId,
        topicId: op.topicId,
        threadId: op.threadId,
        toolMessageId: ids.at(-1),
        assistantMessageId: nextAssistant?.id,
      };
    });
  }

  async executionForTool(toolMessageId: string, batchId: string) {
    const [item] = await this.db
      .select({ id: agentInterventions.id })
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.toolMessageId, toolMessageId),
          eq(agentInterventions.batchId, batchId),
          eq(agentInterventions.userId, this.userId),
          sql`${agentInterventions.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          eq(agentInterventions.status, 'resolving'),
          eq(agentInterventions.source, 'mcp'),
        ),
      )
      .limit(1);
    return item ? this.execution(item.id) : undefined;
  }

  async execution(itemId: string) {
    const [row] = await this.db
      .select({
        state: agentInterventionResolutions.customExecutionState,
        leaseExpiresAt: agentInterventionResolutions.customExecutionLeaseExpiresAt,
        dispatchUntil: sql<number>`coalesce((${agentOperations.metadata}->'mcpResumeDispatch'->(${agentInterventionResolutions.resolutionRequestId})::text->>'leaseUntil')::bigint,0)`,
      })
      .from(agentInterventions)
      .innerJoin(agentOperations, eq(agentOperations.id, agentInterventions.operationId))
      .innerJoin(
        agentInterventionResolutions,
        eq(agentInterventionResolutions.id, agentInterventions.resolutionId),
      )
      .where(
        and(
          eq(agentInterventions.id, itemId),
          eq(agentInterventions.userId, this.userId),
          sql`${agentInterventions.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
          eq(agentInterventionResolutions.userId, this.userId),
          sql`${agentInterventionResolutions.workspaceId} IS NOT DISTINCT FROM ${this.workspaceId ?? null}`,
        ),
      );
    return row;
  }
}
