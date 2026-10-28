import { createHash, randomUUID } from 'node:crypto';

import type { ChatToolPayload } from '@lobechat/types';
import { toRecord } from '@lobechat/utils/object';

import { appEnv } from '@/envs/app';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';

import type { McpCallIdentity, McpElicitationService } from './McpElicitationService';
import { resolveMcpInvocationManifest } from './resume';

export interface ClientMcpStep {
  assistantMessageId: string;
  deadline: number;
  leaseUntil: number;
  owner: string;
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
    sources.push({ assistantMessageId: assistant.id, toolCallId: tool.id, toolMessageId: id });
  }
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
    ...input,
    deadline: Date.now() + 120_000,
    leaseUntil: Date.now() + 45_000,
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
  return { operationId, deadline: Number(stored?.deadline ?? step.deadline) };
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
  // A duplicate delivery never re-enters tools/call, even after an execution lease expires.
  if (!(await service.invocations.claimClientWire(identity.operationId, toolMessageId))) return;
  if (!service.runtime) throw new Error('Client MCP tool host is unavailable');
  const step = operation.metadata?.clientMcpStep as ClientMcpStep;
  let result;
  try {
    if (step.deadline <= Date.now()) throw new Error('Client MCP tool expired before execution');
    const manifest = await resolveMcpInvocationManifest(
      service,
      identity.identifier,
      identity.apiName,
      operation.agentId ?? undefined,
    );
    result = await service.runtime.executeTool(
      { ...tool, type: 'mcp' },
      {
        agentId: operation.agentId ?? undefined,
        assistantMessageId: identity.assistantMessageId,
        operationId: identity.operationId,
        toolCallId: identity.toolCallId,
        toolMessageId,
        executionTimeoutMs: Math.max(1, step.deadline - Date.now()),
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
    await service.messages.updateToolMessage(toolMessageId, {
      content: controlled.result.content,
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
  if (step.deadline + 60_000 > Date.now()) {
    try {
      if (step.deadline > Date.now()) {
        const queued = toRecord(operation.metadata?.mcpClientQueue) ?? {};
        for (const entry of Object.values(queued)) {
          const identity = toRecord(entry)?.identity as McpCallIdentity | undefined;
          if (identity) await scheduleClientMcpTool(service, identity);
        }
      }
    } finally {
      await scheduleClientMcpExpiry(service, operationId, step.deadline);
    }
    return;
  }
  for (const id of step.toolMessageIds) {
    const row = await service.messages.findById(id);
    const plugin = await service.messages.findMessagePlugin(id);
    if (!row || row.content || row.error || plugin?.error || plugin?.state?.mcpClientComplete)
      continue;
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
  await service.operations.mergeMetadata(operationId, { mcpClientExpiryFinished: true });
}
