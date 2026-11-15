import type { LobeChatDatabase } from '@lobechat/database';

import { checkTelemetryEnabled } from '@/libs/trpc/lambda/middleware';
import { scheduleToolCallReport } from '@/server/routers/tools/_helpers/scheduleToolCallReport';
import type { ConnectorToolCallReporter } from '@/server/services/connector/exec';

import { resolveRequestCloudMcpCaller } from './cloudMcpCaller';
import { resolveRequestFileService } from './requestFileService';

interface RequestContext {
  marketAccessToken?: string;
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Reports a marketplace connector's call to the Market the way
 * `tools.mcp.callTool` reports a plugin's: with the request's Market token, and
 * only while the user has telemetry on. `undefined` when neither holds.
 */
export const resolveRequestToolCallReporter = async (
  ctx: RequestContext,
): Promise<ConnectorToolCallReporter | undefined> => {
  const { marketAccessToken } = ctx;
  if (!marketAccessToken) return;
  const { telemetryEnabled } = await checkTelemetryEnabled(ctx);
  if (!telemetryEnabled) return;

  return (report) => scheduleToolCallReport({ ...report, marketAccessToken, telemetryEnabled });
};

/**
 * What a signed-in request's connector tool call runs with: who a cloud tool
 * runs as, where a result's media blocks are stored, and how the call is
 * reported to the Market. Each is resolved only for a call that needs it.
 */
export const withRequestConnectorCallers = <T extends RequestContext>(ctx: T) => ({
  ...ctx,
  resolveCloudMcpCaller: () => resolveRequestCloudMcpCaller(ctx),
  resolveFileService: () => resolveRequestFileService(ctx),
  resolveToolCallReporter: () => resolveRequestToolCallReporter(ctx),
});
