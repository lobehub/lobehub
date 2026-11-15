import { type LobeChatDatabase } from '@lobechat/database';
import { type GetStreamableMcpServerManifestInputSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import type { z } from 'zod';

import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';
import {
  listMcpToolsOnPersonalDevice,
  McpDeviceUnavailableError,
} from '@/server/services/mcp/deviceTunnel';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

/**
 * The manifest of an HTTP MCP server the user set to connect through their
 * device: its tools are listed on the user's own desktop app, then mapped the
 * way the server relay's `getStreamableMcpServerManifest` maps a listing it ran
 * itself. Without a device gateway (self-hosted) the server connects itself.
 *
 * Fails with `PRECONDITION_FAILED` when no desktop app of the user's is online,
 * and with the connection's own error when the listing fails.
 */
export const getDeviceMcpManifest = async ({
  connection,
  serverDB,
  userId,
}: {
  connection: z.infer<typeof GetStreamableMcpServerManifestInputSchema>;
  serverDB: LobeChatDatabase;
  userId: string;
}) => {
  const mcpApps = await isMcpAppsEnabled(userId);
  const params = {
    ...(connection.auth && { auth: connection.auth }),
    connectVia: 'device' as const,
    ...(connection.headers && { headers: connection.headers }),
    name: connection.identifier,
    type: 'http' as const,
    url: connection.url,
  };

  try {
    const rawTools = deviceGateway.isConfigured
      ? await listMcpToolsOnPersonalDevice({ mcpApps, params, serverDB, userId })
      : await mcpService.listRawTools(params, { mcpApps });

    return mcpService.buildStreamableMcpManifest(
      connection.identifier,
      params,
      rawTools,
      connection.metadata,
      { mcpApps },
    );
  } catch (error) {
    // The connection's own TRPC errors (authorization, ...) keep their data
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      cause: error,
      code: error instanceof McpDeviceUnavailableError ? 'PRECONDITION_FAILED' : 'BAD_REQUEST',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
