import { type LobeChatDatabase } from '@lobechat/database';
import { GetStreamableMcpServerManifestInputSchema } from '@lobechat/types';
import type { McpDeviceBinding } from '@lobechat/utils/mcpEndpoint';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { HttpMCPClientParams, StdioMCPParams } from '@/libs/mcp/types';
import { deviceGateway } from '@/server/services/deviceGateway';
import { mcpService } from '@/server/services/mcp';
import {
  listMcpToolsOnDevice,
  McpBoundDeviceUnavailableError,
  McpDeviceUnavailableError,
} from '@/server/services/mcp/deviceTunnel';
import { isMcpAppsEnabled } from '@/server/services/mcp/featureGate';

/**
 * A connection test that must run on the user's device: an HTTP server set to
 * connect through the device, or a stdio server bound to a device other than
 * the desktop testing it. `boundDeviceId`: the device the server is bound to,
 * in the caller's current scope (personal, or the active workspace).
 */
export const DeviceMcpManifestInputSchema = z.union([
  z.object({
    args: z.array(z.string()).default([]),
    boundDeviceId: z.string().min(1).optional(),
    command: z.string().min(1),
    env: z.record(z.string(), z.string()).optional(),
    identifier: z.string(),
    metadata: GetStreamableMcpServerManifestInputSchema.shape.metadata,
    type: z.literal('stdio'),
  }),
  GetStreamableMcpServerManifestInputSchema.extend({
    boundDeviceId: z.string().min(1).optional(),
  }),
]);

export type DeviceMcpManifestInput = z.infer<typeof DeviceMcpManifestInputSchema>;

const toDeviceMcpParams = (
  connection: DeviceMcpManifestInput,
  boundDevice: McpDeviceBinding | undefined,
): HttpMCPClientParams | StdioMCPParams =>
  'command' in connection
    ? {
        args: connection.args,
        ...(boundDevice && { boundDevice }),
        command: connection.command,
        ...(connection.env && { env: connection.env }),
        name: connection.identifier,
        type: 'stdio',
      }
    : {
        ...(connection.auth && { auth: connection.auth }),
        ...(boundDevice && { boundDevice }),
        connectVia: 'device',
        ...(connection.headers && { headers: connection.headers }),
        name: connection.identifier,
        type: 'http',
        url: connection.url,
      };

/**
 * The manifest of an MCP server that runs on the user's device: its tools are
 * listed on the device its calls will run on (the bound one, else the user's
 * newest capable desktop app), then mapped the way the server relay's
 * `getStreamableMcpServerManifest` maps a listing it ran itself. Without a
 * device gateway (self-hosted) the server connects to an HTTP server itself.
 *
 * Fails with `PRECONDITION_FAILED` when no device can run it (the bound device
 * offline, gone, or too old; no desktop app of the user's online), and with the
 * connection's own error when the listing fails.
 */
export const getDeviceMcpManifest = async ({
  connection,
  serverDB,
  userId,
  workspaceId,
}: {
  connection: DeviceMcpManifestInput;
  serverDB: LobeChatDatabase;
  userId: string;
  /** The caller's scope: a binding names a device of this workspace, or a personal one. */
  workspaceId?: string;
}) => {
  const mcpApps = await isMcpAppsEnabled(userId);
  const boundDevice = connection.boundDeviceId
    ? { deviceId: connection.boundDeviceId, ...(workspaceId && { workspaceId }) }
    : undefined;
  const params = toDeviceMcpParams(connection, boundDevice);

  try {
    const rawTools =
      deviceGateway.isConfigured || params.type === 'stdio'
        ? await listMcpToolsOnDevice({ mcpApps, params, serverDB, userId })
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
      code:
        error instanceof McpDeviceUnavailableError ||
        error instanceof McpBoundDeviceUnavailableError
          ? 'PRECONDITION_FAILED'
          : 'BAD_REQUEST',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
