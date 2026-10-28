import { createHash, randomUUID } from 'node:crypto';

import type { ChatToolPayload } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';

import { appEnv } from '@/envs/app';
import { getMcpToolTimeoutMs } from '@/libs/mcp/timeout';
import { resolveToolTimeoutMs } from '@/server/modules/AgentRuntime/resolveToolTimeout';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { archiveToolResultIfNeeded } from '@/server/services/toolExecution/archiveToolResult';

import type { McpCallIdentity, McpElicitationService } from './McpElicitationService';
import { resolveMcpInvocationManifest } from './resume';

export interface ClientMcpStep {
  assistantMessageId: string;
  deadline: number;
  deadlines?: Record<string, number>;
  leaseUntil: number;
  owner: string;
  /** Client archive policy captured before dispatch, including for renderer-free continuations. */
  resultPolicy?: { limit?: number; canReadArchive: boolean };
  toolMessageIds: string[];
}

export async function cancelClientMcpStep(
  service: McpElicitationService,
  operationId: string,
  owner: string,
) {
  if (!(await service.invocations.cancelClientStep(operationId, owner))) return false;
  const operation = await service.operations.findById(operationId);
  const step = operation?.metadata?.clientMcpStep as ClientMcpStep | undefined;
  for (const id of step?.toolMessageIds ?? []) {
    // Older anchors included builtins. Ownership is rechecked before any terminal write.
    if ((await service.messages.findMessagePlugin(id))?.type !== 'mcp') continue;
    const message =
      'The user cancelled this client tool call. A request already sent to the remote server may still have taken effect; it was not repeated.';
    await service.messages.updateToolMessage(id, {
      content: message,
      onlyIfEmpty: true,
      pluginError: { type: 'MCP_CLIENT_TOOL_CANCELLED', message },
      pluginState: { mcpClientComplete: true, mcpElicitation: null },
    });
    await service.messages.updateMessagePlugin(id, { intervention: { status: 'none' } });
  }
  return true;
}

/** Anchor a client step, without moving its agent loop, provider or non-MCP tools to Gateway. */
export async function registerClientMcpStep(
  service: McpElicitationService,
  input: {
    assistantMessageId: string;
    toolMessageIds: string[];
    owner: string;
    localHostTimeoutMs?: number;
    toolResultMaxLength?: number;
  },
) {
  const assistant = await service.messages.findById(input.assistantMessageId);
  if (
    !assistant ||
    assistant.userId !== service.userId ||
    assistant.role !== 'assistant' ||
    !assistant.topicId
  )
    throw new Error('Client MCP assistant is unavailable');
  const tools = (assistant.tools ?? []) as ChatToolPayload[];
  if (
    !tools.length ||
    tools.length > 64 ||
    tools.length < input.toolMessageIds.length ||
    new Set(input.toolMessageIds).size !== input.toolMessageIds.length
  )
    throw new Error('Client MCP batch does not match the original assistant');
  const sources = [];
  const deadlines: Record<string, number> = {};
  const now = Date.now();
  for (const id of input.toolMessageIds) {
    const row = await service.messages.findById(id);
    const plugin = await service.messages.findMessagePlugin(id);
    const tool = tools.find((entry) => entry.id === plugin?.toolCallId);
    if (
      !row ||
      row.userId !== service.userId ||
      row.parentId !== assistant.id ||
      row.topicId !== assistant.topicId ||
      row.threadId !== assistant.threadId ||
      !plugin ||
      !tool ||
      plugin.identifier !== tool.identifier ||
      plugin.apiName !== tool.apiName ||
      plugin.arguments !== tool.arguments
    )
      throw new Error('Client MCP tool identity mismatch');
    if (tool.type !== 'mcp' || plugin.type !== 'mcp') continue;
    const manifest = await resolveMcpInvocationManifest(
      service,
      tool.identifier,
      tool.apiName,
      assistant.agentId ?? undefined,
    );
    const args = toRecord(JSON.parse(tool.arguments || '{}')) ?? {};
    const configured = manifest.api?.find((api) => api.name === tool.apiName)?.defaultTimeoutMs;
    const explicitTimeout = [args.timeout, configured].some(
      (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
    );
    const params = toRecord(manifest.mcpParams);
    const nativeTimeout =
      params?.type === 'stdio' &&
      Number.isFinite(input.localHostTimeoutMs) &&
      Number(input.localHostTimeoutMs) > 0
        ? input.localHostTimeoutMs
        : undefined;
    deadlines[id] =
      now +
      (explicitTimeout
        ? resolveToolTimeoutMs({ apiName: tool.apiName, args, manifest })
        : (nativeTimeout ?? getMcpToolTimeoutMs()));
    sources.push({ assistantMessageId: assistant.id, toolCallId: tool.id, toolMessageId: id });
  }
  if (!sources.length) throw new Error('Client MCP batch has no MCP calls');
  const toolMessageIds = sources.map((source) => source.toolMessageId);
  const operationId = `mcp_client_${createHash('sha256')
    .update(
      JSON.stringify([
        service.userId,
        service.workspaceId,
        assistant.id,
        [...input.toolMessageIds].sort(),
      ]),
    )
    .digest('hex')
    .slice(0, 32)}`;
  const step: ClientMcpStep = {
    assistantMessageId: input.assistantMessageId,
    owner: input.owner,
    toolMessageIds,
    deadlines,
    deadline: Math.max(...Object.values(deadlines)),
    leaseUntil: Date.now() + 45_000,
    resultPolicy: { limit: input.toolResultMaxLength, canReadArchive: true },
  };
  await service.operations.recordStart({
    operationId,
    agentId: assistant.agentId,
    topicId: assistant.topicId,
    threadId: assistant.threadId,
    model: assistant.model ?? undefined,
    provider: assistant.provider ?? undefined,
    metadata: { clientMcpStep: step, mcpInvocationSources: sources },
  });
  const operation = await service.operations.findById(operationId);
  if (operation?.userId !== service.userId) throw new Error('Invalid client MCP operation');
  const stored = toRecord(operation.metadata?.clientMcpStep);
  if (
    stored?.owner !== input.owner &&
    typeof stored?.leaseUntil === 'number' &&
    stored.leaseUntil > Date.now()
  )
    throw new Error('This client step already has a live owner');
  await service.invocations.markClientWaiting(operationId);
  await scheduleClientMcpExpiry(service, operationId, Number(stored?.deadline ?? step.deadline));
  return {
    operationId,
    deadline: Number(stored?.deadline ?? step.deadline),
    deadlines: (stored?.deadlines ??
      Object.fromEntries(
        toolMessageIds.map((id) => [id, Number(stored?.deadline ?? step.deadline)]),
      )) as Record<string, number>,
  };
}

export async function scheduleClientMcpTool(
  service: McpElicitationService,
  identity: McpCallIdentity,
) {
  const { operation } = await service.assertIdentity(identity);
  if (!operation.metadata?.clientMcpStep) throw new Error('Not a client MCP step');
  if (!(await service.invocations.claimClientDispatch(identity.operationId, { ...identity })))
    return;
  const queue = new QueueService();
  const impl = queue.getImpl();
  if (impl instanceof LocalQueueServiceImpl)
    impl.setExecutionCallback(() => executeClientMcpTool(service, identity));
  const base = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  await queue.scheduleMessage({
    operationId: identity.operationId,
    stepIndex: 0,
    endpoint: `${base.replace(/\/$/, '')}/api/agent/mcp-client-tool`,
    deduplicationId: `mcp-client-${identity.operationId}-${identity.toolMessageId}`,
    payload: { identity, userId: service.userId, workspaceId: service.workspaceId },
  });
}

export async function executeClientMcpTool(
  service: McpElicitationService,
  identity: McpCallIdentity,
) {
  const { operation, tool } = await service.assertIdentity(identity);
  const toolMessageId = await service.ensureToolMessage(identity);
  const step = operation.metadata?.clientMcpStep as ClientMcpStep;
  if (!step.toolMessageIds.includes(toolMessageId) || tool.type !== 'mcp')
    throw new Error('Not an owned MCP call');
  const deadline = step.deadlines?.[toolMessageId] ?? step.deadline;
  // A duplicate delivery never re-enters tools/call, even after an execution lease expires.
  if (
    !(await service.invocations.claimClientWire(
      identity.operationId,
      toolMessageId,
      deadline + 60_000,
    ))
  )
    return;
  if (!service.runtime) throw new Error('Client MCP tool host is unavailable');
  let result;
  try {
    if (deadline <= Date.now()) throw new Error('Client MCP tool expired before execution');
    const manifest = await resolveMcpInvocationManifest(
      service,
      identity.identifier,
      identity.apiName,
      operation.agentId ?? undefined,
    );
    result = await service.runtime.executeTool(
      { ...tool, type: 'mcp' },
      {
        skipResultTruncation: true,
        agentId: operation.agentId ?? undefined,
        assistantMessageId: identity.assistantMessageId,
        operationId: identity.operationId,
        toolCallId: identity.toolCallId,
        toolMessageId,
        executionTimeoutMs: Math.max(1, deadline - Date.now()),
        serverDB: service.db,
        userId: service.userId,
        workspaceId: service.workspaceId,
        topicId: operation.topicId ?? undefined,
        threadId: operation.threadId ?? undefined,
        toolManifestMap: { [identity.identifier]: manifest },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MCP tool failed';
    result = {
      content: message,
      success: false,
      executionTime: 0,
      error: { code: 'MCP_CLIENT_TOOL_FAILED', kind: 'stop' as const, message },
    };
  }
  if (!result.deferred) {
    const controlled = await service.runtime.controlCompletedToolResult({
      operationId: identity.operationId,
      toolMessageId,
      result,
    });
    const archived = controlled.blocked
      ? { content: controlled.result.content }
      : await archiveToolResultIfNeeded({
          ...(step.resultPolicy ?? { canReadArchive: true }),
          content: controlled.result.content,
          agentId: operation.agentId,
          topicId: operation.topicId,
          identifier: identity.identifier,
          toolCallId: identity.toolCallId,
          serverDB: service.db,
          userId: service.userId,
          workspaceId: service.workspaceId,
        });
    await service.messages.updateToolMessage(toolMessageId, {
      content: archived.content,
      pluginError: controlled.result.error ?? null,
      pluginState: { ...controlled.result.state, mcpClientComplete: true },
      onlyIfEmpty: true,
    });
  }
}

/** A client may disappear before any interaction opens; queued work still has a durable deadline. */
export async function scheduleClientMcpExpiry(
  service: McpElicitationService,
  operationId: string,
  deadline: number,
) {
  const queue = new QueueService();
  const impl = queue.getImpl();
  if (impl instanceof LocalQueueServiceImpl)
    impl.setExecutionCallback(() => expireClientMcpStep(service, operationId));
  const base = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';
  await queue.scheduleMessage({
    operationId,
    stepIndex: 0,
    endpoint: `${base.replace(/\/$/, '')}/api/agent/mcp-client-expire`,
    delay: Math.max(1, Math.min(deadline + 60_000, Date.now() + 15_000) - Date.now()),
    deduplicationId: `mcp-client-expire-${operationId}-${randomUUID()}`,
    payload: { operationId, userId: service.userId, workspaceId: service.workspaceId },
  });
}

export async function expireClientMcpStep(service: McpElicitationService, operationId: string) {
  const operation = await service.operations.findById(operationId);
  const step = operation?.metadata?.clientMcpStep as ClientMcpStep | undefined;
  if (
    !operation ||
    operation.userId !== service.userId ||
    !['running', 'waiting_for_client'].includes(operation.status) ||
    !step
  )
    return;
  const now = Date.now();
  let waiting = false;
  const queued = toRecord(operation.metadata?.mcpClientQueue) ?? {};
  const wire = toRecord(operation.metadata?.mcpClientWire) ?? {};
  for (const id of step.toolMessageIds) {
    const row = await service.messages.findById(id);
    const plugin = await service.messages.findMessagePlugin(id);
    if (
      plugin?.type !== 'mcp' ||
      !row ||
      row.content ||
      row.error ||
      plugin.error ||
      plugin.state?.mcpClientComplete
    )
      continue;
    const deadline = step.deadlines?.[id] ?? step.deadline;
    const execution = toRecord(wire[id]);
    // A live renderer owns completion, and a live wire/continuation lease owns
    // remote effects. Only explicit stop may retire their output early.
    const intervention = toRecord(plugin.intervention);
    const active =
      typeof intervention?.batchId === 'string'
        ? await service.invocations.executionForTool(id, intervention.batchId)
        : undefined;
    const protectedUntil = Math.max(
      step.leaseUntil,
      Number(execution?.leaseUntil ?? 0),
      active?.leaseExpiresAt?.getTime() ?? 0,
    );
    if (deadline + 60_000 > now || protectedUntil > now) {
      waiting = true;
      if (deadline > now && !wire[id]) {
        const identity = toRecord(queued[id])?.identity as McpCallIdentity | undefined;
        if (identity) await scheduleClientMcpTool(service, identity);
      }
      continue;
    }
    // A continuation has its own fenced unknown-outcome recovery; do not race it.
    if (active?.state === 'executing' || active?.state === 'completed') {
      waiting = true;
      continue;
    }
    const message =
      'The client tool execution expired or disconnected. Its outcome is unknown; the tool was not repeated.';
    await service.messages.updateToolMessage(id, {
      content: message,
      onlyIfEmpty: true,
      pluginError: { message, type: 'MCP_CLIENT_TOOL_TIMEOUT' },
      pluginState: { mcpClientComplete: true, mcpElicitation: null },
    });
    await service.messages.updateMessagePlugin(id, { intervention: { status: 'none' } });
  }
  if (waiting) await scheduleClientMcpExpiry(service, operationId, Math.max(step.deadline, now));
  else await service.operations.mergeMetadata(operationId, { mcpClientExpiryFinished: true });
}
