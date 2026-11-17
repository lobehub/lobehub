import type { LobeChatDatabase } from '@/database/type';
import { connectorRouter } from '@/server/routers/lambda/connector';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import type { ToolCallRequest, ToolCallResult } from '../types/tool-call.type';
import { toMcpUpstreamError } from './mcp-server.service';

interface ToolCallOutcome {
  content?: unknown;
  error?: { message?: unknown; type?: unknown } | null;
  success?: boolean;
}

const toText = (value: unknown) =>
  typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);

/**
 * Direct tool calls (`POST /tools/call`) as the API key's user.
 *
 * Runs through the same `connector.callTool` procedure a conversation uses —
 * the connector must be enabled, the tool synced and not disabled, the agent
 * (if any) visible — with `unattended` set: no human can approve an API call,
 * so a tool that would stop a conversation for approval is refused with
 * `approval_required` instead of run.
 */
export class ToolCallRestService extends BaseService {
  private readonly ctx: { userId: string; workspaceId?: string; workspaceRole?: string };

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId?: string,
    workspaceRole?: string,
  ) {
    super(db, userId, workspaceId);
    this.ctx = { userId: this.userId, workspaceId, workspaceRole };
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResult> {
    let outcome: ToolCallOutcome;
    try {
      outcome = (await connectorRouter.createCaller(this.ctx).callTool({
        agentId: request.agentId,
        args: JSON.stringify(request.arguments ?? {}),
        identifier: request.identifier,
        linkId: request.linkId,
        toolName: request.toolName,
        unattended: true,
      })) as ToolCallOutcome;
    } catch (error) {
      const cause = (error as { cause?: { reason?: string } }).cause;
      if (cause?.reason === 'approval_required') {
        throw new ApiException(403, 'approval_required', (error as Error).message);
      }
      const { code } = error as { code?: string };
      if (code === 'SERVICE_UNAVAILABLE' || code === 'TIMEOUT') throw toMcpUpstreamError(error);
      if (code === 'INTERNAL_SERVER_ERROR') {
        // The procedure wraps every unexpected failure — ours included — with
        // its message; keep that in the log, not in the client's body.
        console.error(`[tools.call] ${request.identifier}.${request.toolName} failed:`, error);
        throw new ApiException(502, 'upstream_error', 'The tool call failed');
      }
      throw error;
    }

    const failed = outcome?.success === false || !!outcome?.error;
    return {
      content: toText(outcome?.content),
      error: failed
        ? {
            message: toText(outcome.error?.message ?? outcome.content),
            type: toText(outcome.error?.type ?? 'TOOL_ERROR'),
          }
        : null,
      success: !failed,
    };
  }
}
