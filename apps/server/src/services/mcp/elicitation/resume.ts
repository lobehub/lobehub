import { createHash } from 'node:crypto';

import type { LobeToolManifest } from '@lobechat/context-engine';
import type { ElicitResult } from '@modelcontextprotocol/client';

import { canonicalJson } from '@/database/models/agentIntervention/utils';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { ConnectorToolPermission } from '@/database/schemas';
import type { AgentRuntimeService } from '@/server/services/agentRuntime';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import type { ToolExecutionService } from '@/server/services/toolExecution';
import { archiveToolResultIfNeeded } from '@/server/services/toolExecution/archiveToolResult';
import type { ToolExecutionResultResponse } from '@/server/services/toolExecution/types';

import { buildPluginMcpParams } from '../pluginParams';
import { mcpConnectionBinding } from './binding';
import { McpElicitationService } from './McpElicitationService';

export interface McpElicitationRuntime extends Pick<
  AgentRuntimeService,
  'controlCompletedToolResult' | 'tryResumeParentFromAsyncTool' | 'isOperationInterrupted'
> {
  executeTool: ToolExecutionService['executeTool'];
  getToolResultPolicy: (
    operationId: string,
  ) => Promise<{ limit?: number; canReadArchive: boolean }>;
}

/** First-winner outbox + fenced execution; a lost response never replays a mutating tools/call. */
export async function resumeMcpElicitation(
  service: McpElicitationService,
  params: {
    itemId: string;
    resolutionRequestId: string;
    responses: Record<string, ElicitResult>;
  },
  runtime = service.runtime,
) {
  if (!runtime) throw new Error('MCP continuation runtime is unavailable');
  const { item, prior } = await service.claim(
    params.itemId,
    params.resolutionRequestId,
    params.responses,
  );
  if (prior && ['acknowledged', 'completed', 'published'].includes(prior.status))
    return { state: 'resolved' as const };
  if (!item.toolMessageId) throw new Error('MCP tool message is missing');
  const { identity, pending, tool } = await service.loadContinuation(item.toolMessageId);
  if (pending.batchId !== item.batchId)
    throw new Error('MCP elicitation was replaced by a newer round');
  if (pending.legacy) return { state: 'resolving' as const };
  const inputHash = createHash('sha256')
    .update(canonicalJson({ itemId: item.id, responses: params.responses }))
    .digest('hex');
  // Bound the wire budget to the lease ceiling, including a minute for durable result commit.
  const executionStartedAt = Date.now();
  const executionDeadline = Math.min(pending.deadline, executionStartedAt + 14 * 60_000);
  const claim = await service.interventions.claimCustomExecution({
    inputHash,
    leaseDurationMs: Math.max(1000, executionDeadline - executionStartedAt + 60_000),
    resolutionRequestId: params.resolutionRequestId,
  });
  if (claim.outcome === 'conflict') throw new Error('MCP continuation has already been claimed');
  if (claim.outcome === 'in_progress') return { state: 'resolving' as const };
  let result: ToolExecutionResultResponse;
  if (claim.outcome === 'completed') {
    result = JSON.parse(claim.result.content) as ToolExecutionResultResponse;
  } else {
    // An expired network execution lease is ambiguous: the remote mutation may
    // already have happened. Settle it visibly instead of repeating it.
    try {
      if (claim.attempt > 1)
        throw new Error(
          'The previous MCP continuation lost its connection. Its outcome is unknown; the operation was not repeated.',
        );
      const operation = await service.operations.findById(identity.operationId);
      if (!operation) throw new Error('MCP operation has ended');
      const manifest = await resolveMcpInvocationManifest(
        service,
        identity.identifier,
        identity.apiName,
        operation.agentId ?? undefined,
      );
      if (
        pending.connectionBinding &&
        mcpConnectionBinding(manifest.mcpParams) !== pending.connectionBinding
      )
        throw new Error('MCP connection changed while awaiting user input');
      if (
        pending.checkpoint?.legacyUrl &&
        Object.values(params.responses).some((response) => response.action !== 'accept')
      )
        throw new Error('The user cancelled the external MCP interaction.');
      if (
        !Object.keys(pending.checkpoint?.inputRequired.inputRequests ?? {}).length &&
        Object.values(params.responses).some((response) => response.action !== 'accept')
      )
        throw new Error('The user cancelled the pending MCP operation.');
      if (await runtime.isOperationInterrupted(identity.operationId))
        throw new Error('The MCP operation was stopped before its continuation started.');
      result = await runtime.executeTool(
        { ...tool, type: 'mcp' },
        {
          skipResultTruncation: true,
          agentId: operation.agentId ?? undefined,
          assistantMessageId: identity.assistantMessageId,
          executionTimeoutMs: Math.max(1, executionDeadline - Date.now()),
          mcpContinuation: McpElicitationService.continuation(pending, params.responses),
          operationId: identity.operationId,
          serverDB: service.db,
          threadId: operation.threadId ?? undefined,
          toolCallId: identity.toolCallId,
          toolManifestMap: { [identity.identifier]: manifest },
          toolMessageId: identity.toolMessageId,
          topicId: operation.topicId ?? undefined,
          userId: service.userId,
          workspaceId: service.workspaceId,
        },
      );
    } catch (error) {
      console.error('MCP elicitation continuation failed', { itemId: item.id, error });
      const message = error instanceof Error ? error.message : 'MCP continuation failed';
      result = {
        content: message,
        error: { code: 'MCP_ELICITATION_FAILED', kind: 'stop', message },
        success: false,
        executionTime: 0,
      };
    }
    const completed = await service.interventions.completeCustomExecution({
      inputHash,
      leaseToken: claim.leaseToken,
      resolutionRequestId: params.resolutionRequestId,
      result: { content: JSON.stringify(result), pluginState: {} },
    });
    if (completed.outcome !== 'completed')
      throw new Error('MCP continuation execution claim was lost');
  }
  if (!result.deferred) {
    const controlled = await runtime.controlCompletedToolResult({
      operationId: identity.operationId,
      toolMessageId: item.toolMessageId,
      result,
    });
    const operation = await service.operations.findById(identity.operationId);
    const policy = await runtime.getToolResultPolicy(identity.operationId);
    const archive = controlled.blocked
      ? { content: controlled.result.content }
      : await archiveToolResultIfNeeded({
          ...policy,
          content: controlled.result.content,
          agentId: operation?.agentId,
          topicId: operation?.topicId,
          identifier: identity.identifier,
          toolCallId: identity.toolCallId,
          serverDB: service.db,
          userId: service.userId,
          workspaceId: service.workspaceId,
        });
    await service.messages.updateToolMessage(item.toolMessageId, {
      content: archive.content,
      onlyIfEmpty: true,
      pluginError: controlled.result.error ?? null,
      pluginState: { ...controlled.result.state, mcpElicitation: pending, mcpClientComplete: true },
      ...(controlled.blocked && { replacePluginState: true }),
    });
    await runtime.tryResumeParentFromAsyncTool(
      { parentOperationId: identity.operationId },
      { knownFulfilledMessageId: item.toolMessageId, scheduleVerifyOnHold: true },
    );
  }
  await service.interventions.markResolutionPublished(params.resolutionRequestId);
  await service.interventions.completeMcpResolution(params.resolutionRequestId);
  if (!result.deferred) {
    // Keep both checkpoint and current-batch recovery projection until parent dispatch is durable.
    await service.messages.updatePluginState(item.toolMessageId, { mcpElicitation: null });
    await service.messages.updateMessagePlugin(item.toolMessageId, {
      intervention: { batchId: item.batchId, operationId: item.operationId, status: 'none' },
    });
  }
  return { state: result.deferred ? ('pending' as const) : ('resolved' as const) };
}

/** Resolve current server-owned credentials and tool permissions for both runtime hosts. */
export async function resolveMcpInvocationManifest(
  service: McpElicitationService,
  identifier: string,
  apiName: string,
  agentId?: string,
) {
  const connectorModel = new ConnectorModel(service.db, service.userId, service.workspaceId);
  const [connector] = await connectorModel.resolveByIdentifiers([identifier], agentId ?? undefined);
  let manifest: LobeToolManifest & { mcpParams: unknown };
  if (connector) {
    if (!connector.isEnabled) throw new Error('MCP connector is disabled');
    const tools = await new ConnectorToolModel(
      service.db,
      service.userId,
      service.workspaceId,
    ).queryByConnector(connector.id);
    const allowedTool = tools.find((entry) => entry.toolName === apiName);
    if (!allowedTool || allowedTool.permission === ConnectorToolPermission.disabled)
      throw new Error('MCP tool is no longer available');
    const fresh = await ensureFreshConnectorToken(connector, connectorModel);
    manifest = {
      identifier,
      api: [],
      meta: {},
      mcpParams: buildConnectorMcpParams(fresh),
    };
  } else {
    const plugin = await new PluginModel(service.db, service.userId, service.workspaceId).findById(
      identifier,
    );
    if (!plugin?.customParams?.mcp || !plugin.manifest?.api.some((api) => api.name === apiName))
      throw new Error('MCP plugin is no longer installed or available');
    const mcpParams = buildPluginMcpParams(plugin);
    if (!mcpParams) throw new Error('MCP plugin connection is unavailable');
    manifest = { ...plugin.manifest, mcpParams };
  }
  return manifest;
}
