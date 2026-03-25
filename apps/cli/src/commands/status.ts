import { GatewayClient } from '@lobechat/device-gateway-client';
import type { Command } from 'commander';

import { resolveToken } from '../auth/resolveToken';
import { OFFICIAL_GATEWAY_URL } from '../constants/urls';
import { loadSettings, normalizeUrl, saveSettings } from '../settings';
import { log, setVerbose } from '../utils/logger';

interface StatusOptions {
  gateway?: string;
  serviceToken?: string;
  timeout?: string;
  token?: string;
  userId?: string;
  verbose?: boolean;
}

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Check if gateway connection can be established')
    .option('--token <jwt>', 'JWT access token')
    .option('--service-token <token>', 'Service token (requires --user-id)')
    .option('--user-id <id>', 'User ID (required with --service-token)')
    .option('--gateway <url>', 'Device gateway URL')
    .option('--timeout <ms>', 'Connection timeout in ms', '10000')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options: StatusOptions) => {
      if (options.verbose) setVerbose(true);

      const auth = await resolveToken(options);
      const settings = loadSettings();
      const gatewayUrl = normalizeUrl(options.gateway) || settings?.gatewayUrl;

      if (!gatewayUrl && settings?.serverUrl) {
        log.error(
          `Current login uses custom --server ${settings?.serverUrl}. Please also provide '--gateway <url>' for the device gateway.`,
        );
        process.exit(1);
        throw new Error('process.exit');
      }

      if (options.gateway && gatewayUrl) {
        saveSettings({ ...settings, gatewayUrl });
      }

      const timeout = Number.parseInt(options.timeout || '10000', 10);

      const client = new GatewayClient({
        autoReconnect: false,
        gatewayUrl: gatewayUrl || OFFICIAL_GATEWAY_URL,
        logger: log,
        serverUrl: auth.serverUrl,
        token: auth.token,
        tokenType: auth.tokenType,
        userId: auth.userId,
      });

      const timer = setTimeout(() => {
        log.error('FAILED - Connection timed out');
        client.disconnect();
        process.exit(1);
      }, timeout);

      client.on('connected', () => {
        clearTimeout(timer);
        log.info('CONNECTED');
        client.disconnect();
        process.exit(0);
      });

      client.on('disconnected', () => {
        clearTimeout(timer);
        log.error('FAILED - Connection closed by server');
        process.exit(1);
      });

      client.on('auth_failed', (reason) => {
        clearTimeout(timer);
        log.error(`FAILED - Authentication failed: ${reason}`);
        process.exit(1);
      });

      client.on('auth_expired', () => {
        clearTimeout(timer);
        log.error('FAILED - Authentication expired');
        client.disconnect();
        process.exit(1);
      });

      client.on('error', (error) => {
        log.error(`Connection error: ${error.message}`);
      });

      await client.connect();
    });
}
