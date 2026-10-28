import { createHash } from 'node:crypto';

import type { LobeToolManifest } from '@lobechat/context-engine';
import type { ElicitResult } from '@modelcontextprotocol/client';

import { canonicalJson } from '@/database/models/agentIntervention/utils';
import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import { ConnectorToolPermission } from '@/database/schemas';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { buildConnectorMcpParams } from '@/server/services/connector/sync';
import { ensureFreshConnectorToken } from '@/server/services/connector/tokens';
import { mcpService } from '@/server/services/mcp';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';
import type { ToolExecutionResultResponse } from '@/server/services/toolExecution/types';

import { buildPluginMcpParams } from '../pluginParams';
import { mcpConnectionBinding } from './binding';
import { expireMcpElicitation } from './expire';
import { McpElicitationService } from './McpElicitationService';

/** First-winner outbox + fenced execution; a lost response never replays a mutating tools/call. */
export async function resumeMcpElicitation(
  service: McpElicitationService,
  params: {
    itemId: string;
    resolutionRequestId: string;
    responses: Record<string, ElicitResult>;
  },
) {
  const runtime = new AgentRuntimeService(service.db, service.userId, {
    workspaceId: service.workspaceId,
  });
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
  const claim = await service.interventions.claimCustomExecution({
    inputHash,
    leaseDurationMs: 120_000,
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
      const connectorModel = new ConnectorModel(service.db, service.userId, service.workspaceId);
      const [connector] = await connectorModel.resolveByIdentifiers(
        [identity.identifier],
        operation.agentId ?? undefined,
      );
      let manifest: LobeToolManifest & { mcpParams: unknown };
      if (connector) {
        if (!connector.isEnabled) throw new Error('MCP connector is disabled');
        const tools = await new ConnectorToolModel(
          service.db,
          service.userId,
          service.workspaceId,
        ).queryByConnector(connector.id);
        const allowedTool = tools.find((entry) => entry.toolName === identity.apiName);
        if (!allowedTool || allowedTool.permission === ConnectorToolPermission.disabled)
          throw new Error('MCP tool is no longer available');
        const fresh = await ensureFreshConnectorToken(connector, connectorModel);
        manifest = {
          identifier: identity.identifier,
          api: [],
          meta: {},
          mcpParams: buildConnectorMcpParams(fresh),
        };
      } else {
        const plugin = await new PluginModel(
          service.db,
          service.userId,
          service.workspaceId,
        ).findById(identity.identifier);
        if (
          !plugin?.customParams?.mcp ||
          !plugin.manifest?.api.some((api) => api.name === identity.apiName)
        )
          throw new Error('MCP plugin is no longer installed or available');
        const mcpParams = buildPluginMcpParams(plugin);
        if (!mcpParams) throw new Error('MCP plugin connection is unavailable');
        manifest = { ...plugin.manifest, mcpParams };
      }
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
      const executor = new ToolExecutionService({
        builtinToolsExecutor: new BuiltinToolsExecutor(service.db, service.userId),
        mcpService,
        onMcpElicitationExpired: (pendingService, itemId) =>
          expireMcpElicitation(pendingService, itemId, runtime),
      });
      result = await executor.executeTool(
        { ...tool, type: 'mcp' },
        {
          agentId: operation.agentId ?? undefined,
          assistantMessageId: identity.assistantMessageId,
          executionTimeoutMs: Math.max(1, pending.deadline - Date.now()),
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
    await service.messages.updateToolMessage(item.toolMessageId, {
      content: controlled.result.content,
      onlyIfEmpty: true,
      pluginError: controlled.result.error ?? null,
      pluginState: { ...controlled.result.state, mcpElicitation: null },
      ...(controlled.blocked && { replacePluginState: true }),
    });
    await service.messages.updateMessagePlugin(item.toolMessageId, {
      intervention: { batchId: item.batchId, operationId: item.operationId, status: 'none' },
    });
    await runtime.tryResumeParentFromAsyncTool(
      { parentOperationId: identity.operationId },
      { knownFulfilledMessageId: item.toolMessageId, scheduleVerifyOnHold: true },
    );
  }
  await service.interventions.markResolutionPublished(params.resolutionRequestId);
  await service.interventions.completeMcpResolution(params.resolutionRequestId);
  return { state: result.deferred ? ('pending' as const) : ('resolved' as const) };
}
