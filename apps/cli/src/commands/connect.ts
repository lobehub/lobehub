import os from 'node:os';
import path from 'node:path';

import type {
  DeviceSystemInfo,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
} from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import type { Command } from 'commander';

import { resolveToken } from '../auth/resolveToken';
import { executeToolCall } from '../tools';
import { cleanupAllProcesses } from '../tools/shell';
import { log, setVerbose } from '../utils/logger';

interface ConnectOptions {
  deviceId?: string;
  gateway?: string;
  serviceToken?: string;
  token?: string;
  userId?: string;
  verbose?: boolean;
}

export function registerConnectCommand(program: Command) {
  program
    .command('connect')
    .description('Connect to the device gateway and listen for tool calls')
    .option('--token <jwt>', 'JWT access token')
    .option('--service-token <token>', 'Service token (requires --user-id)')
    .option('--user-id <id>', 'User ID (required with --service-token)')
    .option('--gateway <url>', 'Gateway URL', 'https://device-gateway.lobehub.com')
    .option('--device-id <id>', 'Device ID (auto-generated if not provided)')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options: ConnectOptions) => {
      if (options.verbose) setVerbose(true);

      const auth = await resolveToken(options);

      const client = new GatewayClient({
        deviceId: options.deviceId,
        gatewayUrl: options.gateway,
        logger: log,
        token: auth.token,
        userId: auth.userId,
      });

      // Print device info
      log.info('─── LobeHub CLI ───');
      log.info(`  Device ID : ${client.currentDeviceId}`);
      log.info(`  Hostname  : ${os.hostname()}`);
      log.info(`  Platform  : ${process.platform}`);
      log.info(`  Gateway   : ${options.gateway || 'https://device-gateway.lobehub.com'}`);
      log.info(`  Auth      : ${options.serviceToken ? 'service-token' : 'jwt'}`);
      log.info('───────────────────');

      // Handle system info requests
      client.on('system_info_request', (request: SystemInfoRequestMessage) => {
        log.info(`Received system_info_request: requestId=${request.requestId}`);
        const systemInfo = collectSystemInfo();
        client.sendSystemInfoResponse({
          requestId: request.requestId,
          result: { success: true, systemInfo },
        });
      });

      // Handle tool call requests
      client.on('tool_call_request', async (request: ToolCallRequestMessage) => {
        const { requestId, toolCall } = request;
        log.toolCall(toolCall.apiName, requestId, toolCall.arguments);

        const result = await executeToolCall(toolCall.apiName, toolCall.arguments);
        log.toolResult(requestId, result.success, result.content);

        client.sendToolCallResponse({
          requestId,
          result: {
            content: result.content,
            error: result.error,
            success: result.success,
          },
        });
      });

      // Handle auth failed
      client.on('auth_failed', (reason) => {
        log.error(`Authentication failed: ${reason}`);
        log.error("Run 'lh login' to re-authenticate.");
        cleanup();
        process.exit(1);
      });

      // Handle auth expired — try refresh before giving up
      client.on('auth_expired', async () => {
        log.warn('Authentication expired. Attempting to refresh...');
        const refreshed = await resolveToken({});
        if (refreshed) {
          log.info('Token refreshed. Please reconnect.');
        } else {
          log.error("Could not refresh token. Run 'lh login' to re-authenticate.");
        }
        cleanup();
        process.exit(1);
      });

      // Handle errors
      client.on('error', (error) => {
        log.error(`Connection error: ${error.message}`);
      });

      // Graceful shutdown
      const cleanup = () => {
        log.info('Shutting down...');
        cleanupAllProcesses();
        client.disconnect();
      };

      process.on('SIGINT', () => {
        cleanup();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        cleanup();
        process.exit(0);
      });

      // Connect
      await client.connect();
    });
}

function collectSystemInfo(): DeviceSystemInfo {
  const home = os.homedir();
  const platform = process.platform;

  // Platform-specific video path name
  const videosDir = platform === 'linux' ? 'Videos' : 'Movies';

  return {
    arch: os.arch(),
    desktopPath: path.join(home, 'Desktop'),
    documentsPath: path.join(home, 'Documents'),
    downloadsPath: path.join(home, 'Downloads'),
    homePath: home,
    musicPath: path.join(home, 'Music'),
    picturesPath: path.join(home, 'Pictures'),
    userDataPath: path.join(home, '.lobehub'),
    videosPath: path.join(home, videosDir),
    workingDirectory: process.cwd(),
  };
}
