import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type {
  McpElicitationCheckpoint,
  McpElicitationContinuation,
  McpElicitationHost,
} from '@lobechat/mcp-elicitation';
import { validateMcpElicitationResponse } from '@lobechat/mcp-elicitation/form';
import { mcpInvocationKey } from '@lobechat/mcp-elicitation/transport';
import { MCP_CONTINUATION_CONTROL } from '@lobechat/mcp-elicitation/types';
import type { ChatToolPayload } from '@lobechat/types';
import type {
  ElicitRequestParams,
  ElicitResult,
  InputResponses,
} from '@modelcontextprotocol/client';
import { isEqual } from 'es-toolkit';

import { AgentInterventionModel } from '@/database/models/agentIntervention';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { ConnectorModel } from '@/database/models/connector';
import { McpInvocationModel } from '@/database/models/mcpInvocation';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

import { postLocalMcpCallback } from './localCallback';
import type { McpElicitationRuntime } from './resume';

export interface McpCallIdentity {
  apiName: string;
  assistantMessageId: string;
  identifier: string;
  operationId: string;
  toolCallId: string;
  toolMessageId?: string;
}

export interface StoredMcpElicitation {
  batchId: string;
  checkpoint?: McpElicitationCheckpoint;
  connectionBinding?: string;
  deadline: number;
  kind: 'mcp_elicitation';
  legacy: boolean;
  requests: Record<string, ElicitRequestParams>;
}

/** The runtime owns execution; the interaction store never imports the runtime. */
export type McpElicitationExpiry = (
  service: McpElicitationService,
  itemId: string,
) => Promise<void>;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Uses the same sealed intervention batches and private resolution outbox as ask-user. */
export class McpElicitationService {
  readonly invocations: McpInvocationModel;
  readonly interventions: AgentInterventionModel;
  readonly messages: MessageModel;
  readonly operations: AgentOperationModel;

  constructor(
    readonly db: LobeChatDatabase,
    readonly userId: string,
    readonly workspaceId?: string,
    private readonly onExpire?: McpElicitationExpiry,
    readonly runtime?: McpElicitationRuntime,
  ) {
    this.interventions = new AgentInterventionModel(db, userId, workspaceId);
    this.invocations = new McpInvocationModel(db, userId, workspaceId);
    this.messages = new MessageModel(db, userId, workspaceId);
    this.operations = new AgentOperationModel(db, userId, workspaceId);
  }

  async assertIdentity(identity: McpCallIdentity, allowEnded = false) {
    const operation = await this.operations.findById(identity.operationId);
    const assistant = await this.messages.findById(identity.assistantMessageId);
    const sources = operation?.metadata?.mcpInvocationSources;
    const approvedSource =
      Array.isArray(sources) &&
      sources.find(
        (source) =>
          source?.assistantMessageId === identity.assistantMessageId &&
          source?.toolCallId === identity.toolCallId &&
          (!identity.toolMessageId || source.toolMessageId === identity.toolMessageId),
      );
    const sourceRow = approvedSource
      ? await this.messages.findById(approvedSource.toolMessageId)
      : undefined;
    const sourcePlugin = sourceRow
      ? await this.messages.findMessagePlugin(sourceRow.id)
      : undefined;
    const approvedContinuation =
      sourceRow?.role === 'tool' &&
      sourceRow.userId === this.userId &&
      sourcePlugin?.toolCallId === identity.toolCallId &&
      sourcePlugin.identifier === identity.identifier &&
      sourcePlugin.apiName === identity.apiName &&
      sourceRow.parentId === identity.assistantMessageId &&
      sourceRow.topicId === operation?.topicId &&
      sourceRow.threadId === operation?.threadId;
    if (
      !operation ||
      operation.userId !== this.userId ||
      !assistant ||
      assistant.userId !== this.userId ||
      assistant.role !== 'assistant' ||
      (assistant.metadata?.operationId !== identity.operationId && !approvedContinuation) ||
      assistant.topicId !== operation.topicId ||
      assistant.threadId !== operation.threadId
    )
      throw new Error('MCP tool call does not belong to this conversation');
    const tool = (
      Array.isArray(assistant.tools) ? (assistant.tools as ChatToolPayload[]) : []
    ).find((item) => item.id === identity.toolCallId);
    if (!tool || tool.identifier !== identity.identifier || tool.apiName !== identity.apiName)
      throw new Error('MCP tool call identity mismatch');
    if (!allowEnded && ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status))
      throw new Error('MCP operation has ended');
    return {
      operation,
      tool,
      approvedToolMessageId: approvedContinuation ? sourceRow.id : undefined,
    };
  }

  async ensureToolMessage(identity: McpCallIdentity) {
    const { operation, tool, approvedToolMessageId } = await this.assertIdentity(identity);
    const id =
      identity.toolMessageId ??
      approvedToolMessageId ??
      `mcp_${hash(mcpInvocationKey({ ...identity, userId: this.userId, workspaceId: this.workspaceId })).slice(0, 24)}`;
    const existing = await this.messages.findById(id);
    if (!existing) {
      await this.messages.create(
        {
          agentId: operation.agentId ?? undefined,
          content: '',
          parentId: identity.assistantMessageId,
          plugin: {
            apiName: tool.apiName,
            arguments: tool.arguments,
            identifier: tool.identifier,
            type: tool.type,
          },
          role: 'tool',
          threadId: operation.threadId ?? undefined,
          tool_call_id: tool.id,
          topicId: operation.topicId ?? undefined,
        },
        id,
      );
    }
    const row = await this.messages.findById(id);
    const plugin = await this.messages.findMessagePlugin(id);
    if (
      !row ||
      row.userId !== this.userId ||
      row.parentId !== identity.assistantMessageId ||
      plugin?.toolCallId !== identity.toolCallId ||
      plugin.identifier !== identity.identifier ||
      plugin.apiName !== identity.apiName
    )
      throw new Error('MCP tool message identity mismatch');
    return id;
  }

  async open(
    identity: McpCallIdentity,
    pending: Omit<StoredMcpElicitation, 'batchId' | 'kind'>,
    batchId = randomUUID(),
  ) {
    const toolMessageId = await this.ensureToolMessage(identity);
    const { operation } = await this.assertIdentity(identity);
    const [connector] = await new ConnectorModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).resolveByIdentifiers([identity.identifier], operation.agentId ?? undefined);
    const plugin = connector
      ? undefined
      : await new PluginModel(this.db, this.userId, this.workspaceId).findById(identity.identifier);
    const serverName = connector?.name ?? plugin?.manifest?.meta.title ?? identity.identifier;
    const state: StoredMcpElicitation = { ...pending, batchId, kind: 'mcp_elicitation' };
    const request = {
      apiName: identity.apiName,
      identifier: identity.identifier,
      customDetail: {
        kind: 'mcp_elicitation' as const,
        requests: JSON.stringify(pending.requests),
        serverName,
      },
    };
    const revision = hash(JSON.stringify({ identity, state }));
    const [item] = await this.interventions.createBatch({
      activityKey: `mcp:${identity.operationId}:${identity.toolCallId}:${batchId}`,
      batchId,
      deadline: new Date(pending.deadline),
      items: [
        {
          allowedActions: ['submit_custom'],
          interactionKind: 'custom',
          requestRevisionHash: revision,
          reviewContext: { title: identity.identifier, summary: 'MCP server requests user input' },
          reviewTokenHash: hash(randomUUID()),
          sanitizedRequest: request,
          surface: 'form',
          toolCallId: identity.toolCallId,
          toolMessageId,
        },
      ],
      operationId: identity.operationId,
      source: 'mcp',
      stepIndex: pending.checkpoint?.round ?? 0,
      systemActionEligibility: 'review_only',
    });
    await this.messages.updatePluginState(toolMessageId, { mcpElicitation: state });
    await this.messages.updateMessagePlugin(toolMessageId, {
      intervention: { batchId, operationId: identity.operationId, status: 'pending' },
    });
    {
      try {
        await this.scheduleExpiry(
          item.id,
          identity.operationId,
          pending.legacy
            ? pending.deadline + 1_000
            : Math.min(pending.deadline, Date.now() + 15_000),
          pending.checkpoint?.round ?? 0,
        );
      } catch (error) {
        await this.interventions.markBatchTerminal(identity.operationId, batchId, 'session_ended');
        await this.messages.updateMessagePlugin(toolMessageId, {
          intervention: { batchId, operationId: identity.operationId, status: 'none' },
        });
        await this.messages.updatePluginState(toolMessageId, { mcpElicitation: null });
        throw error;
      }
    }
    return { item, state, toolMessageId };
  }

  /** A wakeup must never be acknowledged without retaining the next not-before deadline. */
  async scheduleExpiry(
    itemId: string,
    operationId: string,
    deadline: number,
    stepIndex = 0,
    rearm = false,
  ) {
    const queue = new QueueService();
    const impl = queue.getImpl();
    const base = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
    if (impl instanceof LocalQueueServiceImpl) {
      const onExpire = this.onExpire;
      impl.setExecutionCallback(() =>
        onExpire
          ? onExpire(this, itemId)
          : postLocalMcpCallback(`${base.replace(/\/$/, '')}/api/agent/mcp-elicitation-expire`, {
              itemId,
              userId: this.userId,
              workspaceId: this.workspaceId,
            }),
      );
    }
    await queue.scheduleMessage({
      endpoint: `${base.replace(/\/$/, '')}/api/agent/mcp-elicitation-expire`,
      operationId,
      stepIndex,
      delay: Math.max(1, deadline - Date.now()),
      // A redelivery before deadline must not dedupe against the task being acknowledged.
      deduplicationId: `mcp-expire-${itemId}${rearm ? `-${randomUUID()}` : ''}`,
      payload: { itemId, userId: this.userId, workspaceId: this.workspaceId },
    });
  }

  createLegacyHost(identity: McpCallIdentity, deadline: number): McpElicitationHost {
    return {
      request: async (request, { signal, checkpoint }) => {
        const stateOnly =
          checkpoint &&
          !checkpoint.legacyUrl &&
          !Object.keys(checkpoint.inputRequired.inputRequests ?? {}).length;
        const pending = await this.open(identity, {
          checkpoint,
          deadline,
          legacy: true,
          requests: stateOnly ? {} : { input: request },
        });
        try {
          while (!signal.aborted && Date.now() < deadline) {
            const batch = await this.interventions.findBatch(
              identity.operationId,
              pending.state.batchId,
            );
            const row = batch.interventions[0];
            if (!row || ['cancelled', 'timed_out', 'session_ended'].includes(row.status))
              return { action: 'cancel' };
            const resolution = batch.resolutions[0];
            if (resolution?.action.type === 'submit_custom') {
              const responses = JSON.parse(String(resolution.action.result.responses)) as Record<
                string,
                ElicitResult
              >;
              await this.interventions.markResolutionPublished(resolution.resolutionRequestId);
              await this.interventions.completeMcpResolution(resolution.resolutionRequestId);
              await this.messages.updateMessagePlugin(pending.toolMessageId, {
                intervention: { status: 'none' },
              });
              return responses[stateOnly ? MCP_CONTINUATION_CONTROL : 'input'];
            }
            const operation = await this.operations.findById(identity.operationId);
            if (
              !operation ||
              ['done', 'error', 'interrupted', 'abandoned'].includes(operation.status)
            )
              return { action: 'cancel' };
            await delay(350, undefined, { signal });
          }
          return { action: 'cancel' };
        } finally {
          await this.interventions.markBatchTerminal(
            identity.operationId,
            pending.state.batchId,
            signal.aborted ? 'session_ended' : 'timed_out',
          );
          await this.messages.updateMessagePlugin(pending.toolMessageId, {
            intervention: {
              batchId: pending.state.batchId,
              operationId: identity.operationId,
              status: 'none',
            },
          });
          await this.messages.updatePluginState(pending.toolMessageId, { mcpElicitation: null });
        }
      },
    };
  }

  async get(itemId: string) {
    const item = await this.interventions.findById(itemId);
    if (!item || item.userId !== this.userId || item.source !== 'mcp')
      throw new Error('MCP elicitation not found');
    return item;
  }

  async claim(
    itemId: string,
    resolutionRequestId: string,
    responses: Record<string, ElicitResult>,
  ) {
    const item = await this.get(itemId);
    const detail = item.sanitizedRequest.customDetail;
    if (detail?.kind !== 'mcp_elicitation') throw new Error('Invalid MCP elicitation');
    const requests = JSON.parse(detail.requests) as Record<string, ElicitRequestParams>;
    if (
      JSON.stringify(
        Object.keys(requests).length ? Object.keys(requests).sort() : [MCP_CONTINUATION_CONTROL],
      ) !== JSON.stringify(Object.keys(responses).sort())
    )
      throw new Error('MCP elicitation response identity mismatch');
    if (!Object.keys(requests).length) {
      const control = responses[MCP_CONTINUATION_CONTROL];
      if (
        !['accept', 'decline', 'cancel'].includes(control.action) ||
        control.content !== undefined
      )
        throw new Error('Invalid MCP continuation control');
    }
    for (const [key, request] of Object.entries(requests)) {
      const errors = validateMcpElicitationResponse(request, responses[key]);
      if (errors.length) throw new Error(errors.join('\n'));
    }
    const prior = await this.interventions.findResolutionByRequestId(resolutionRequestId);
    if (prior) {
      if (
        prior.operationId !== item.operationId ||
        prior.batchId !== item.batchId ||
        prior.actorId !== this.userId ||
        prior.source !== 'mcp' ||
        prior.action.type !== 'submit_custom' ||
        !isEqual(JSON.parse(String(prior.action.result.responses)), responses)
      )
        throw new Error('MCP resolution id was reused for a different response');
      return { item, prior };
    }
    if (
      !item.toolMessageId ||
      (await this.loadContinuation(item.toolMessageId)).pending.batchId !== item.batchId
    )
      throw new Error('MCP elicitation was replaced by a newer round');
    const claim = await this.interventions.claimBatch({
      action: {
        expectedRevisionHash: item.requestRevisionHash,
        result: { responses: JSON.stringify(responses) },
        type: 'submit_custom',
      },
      actorId: this.userId,
      batchId: item.batchId,
      expectedItemCount: 1,
      expectedRequestRevisionHashes: { [item.id]: item.requestRevisionHash },
      expectedVersions: { [item.id]: item.version },
      operationId: item.operationId,
      resolutionRequestId,
      scope: 'single',
      selectedInterventionIds: [item.id],
    });
    if (claim.outcome !== 'applied' && claim.outcome !== 'idempotent')
      throw new Error('MCP elicitation is no longer pending');
    return { claim, item, prior: undefined };
  }

  async loadContinuation(
    toolMessageId: string,
  ): Promise<{ identity: McpCallIdentity; pending: StoredMcpElicitation; tool: ChatToolPayload }> {
    const row = await this.messages.findById(toolMessageId);
    const plugin = await this.messages.findMessagePlugin(toolMessageId);
    const pending = plugin?.state?.mcpElicitation as StoredMcpElicitation | undefined;
    if (
      !row ||
      row.userId !== this.userId ||
      !plugin?.apiName ||
      !plugin.identifier ||
      !plugin?.intervention?.operationId ||
      !pending ||
      !plugin.toolCallId ||
      !row.parentId
    )
      throw new Error('MCP continuation is unavailable');
    const identity = {
      apiName: plugin.apiName,
      assistantMessageId: row.parentId,
      identifier: plugin.identifier,
      operationId: plugin.intervention.operationId,
      toolCallId: plugin.toolCallId,
      toolMessageId,
    };
    const { tool } = await this.assertIdentity(identity);
    return { identity, pending, tool };
  }

  static continuation(
    pending: StoredMcpElicitation,
    inputResponses: InputResponses,
  ): McpElicitationContinuation {
    if (!pending.checkpoint) throw new Error('Missing modern MCP checkpoint');
    return {
      ...pending.checkpoint,
      inputResponses: Object.keys(pending.checkpoint.inputRequired.inputRequests ?? {}).length
        ? inputResponses
        : {},
    };
  }
}
