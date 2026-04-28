import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  DeviceSystemInfo,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
} from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import type { Command } from 'commander';

import { getValidToken } from '../auth/refresh';
import { resolveToken } from '../auth/resolveToken';
import { CLI_API_KEY_ENV } from '../constants/auth';
import { OFFICIAL_GATEWAY_URL } from '../constants/urls';
import {
  appendLog,
  getLogPath,
  getRunningDaemonPid,
  readStatus,
  removePid,
  removeStatus,
  spawnDaemon,
  stopDaemon,
  writeStatus,
} from '../daemon/manager';
import { loadSettings, normalizeUrl, saveSettings } from '../settings';
import { executeToolCall } from '../tools';
import { cleanupAllProcesses } from '../tools/shell';
import { log, setVerbose } from '../utils/logger';

interface ConnectOptions {
  daemon?: boolean;
  daemonChild?: boolean;
  deviceId?: string;
  gateway?: string;
  token?: string;
  verbose?: boolean;
}

export function registerConnectCommand(program: Command) {
  const connectCmd = program
    .command('connect')
    .description('Connect to the device gateway and listen for tool calls')
    .option('--token <jwt>', 'JWT access token')
    .option('--gateway <url>', 'Device gateway URL')
    .option('--device-id <id>', 'Device ID (auto-generated if not provided)')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-d, --daemon', 'Run as a background daemon process')
    .option('--daemon-child', 'Internal: runs as the daemon child process')
    .action(async (options: ConnectOptions) => {
      if (options.verbose) setVerbose(true);

      // --daemon: spawn detached child and exit
      if (options.daemon) {
        return handleDaemonStart(options);
      }

      // --daemon-child: running inside daemon, redirect logging
      const isDaemonChild = options.daemonChild || process.env.LOBEHUB_DAEMON === '1';

      await runConnect(options, isDaemonChild);
    });

  // Subcommands
  connectCmd
    .command('stop')
    .description('Stop the background daemon process')
    .action(() => {
      const stopped = stopDaemon();
      if (stopped) {
        log.info('Daemon stopped.');
      } else {
        log.warn('No daemon is running.');
      }
    });

  connectCmd
    .command('status')
    .description('Show background daemon status')
    .action(() => {
      const pid = getRunningDaemonPid();
      if (pid === null) {
        log.info('No daemon is running.');
        return;
      }

      const status = readStatus();
      log.info('─── Daemon Status ───');
      log.info(`  PID              : ${pid}`);
      if (status) {
        log.info(`  Started at       : ${status.startedAt}`);
        log.info(`  Connection       : ${status.connectionStatus}`);
        log.info(`  Gateway          : ${status.gatewayUrl}`);
        const uptime = formatUptime(new Date(status.startedAt));
        log.info(`  Uptime           : ${uptime}`);
      }
      log.info('─────────────────────');
    });

  connectCmd
    .command('logs')
    .description('Tail the daemon log file')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output')
    .action(async (opts: { follow?: boolean; lines?: string }) => {
      const logPath = getLogPath();
      if (!fs.existsSync(logPath)) {
        log.warn('No log file found. Start the daemon first.');
        return;
      }

      const lines = opts.lines || '50';
      const args = [`-n`, lines];
      if (opts.follow) args.push('-f');

      // Use tail directly — this hands control to the child process
      try {
        const { execFileSync } = await import('node:child_process');
        execFileSync('tail', [...args, logPath], { stdio: 'inherit' });
      } catch {
        // tail -f exits via SIGINT, which throws — that's fine
      }
    });

  connectCmd
    .command('restart')
    .description('Restart the background daemon process')
    .option('--token <jwt>', 'JWT access token')
    .option('--gateway <url>', 'Device gateway URL')
    .option('--device-id <id>', 'Device ID')
    .option('-v, --verbose', 'Enable verbose logging')
    .action((options: ConnectOptions) => {
      const wasStopped = stopDaemon();
      if (wasStopped) {
        log.info('Stopped existing daemon.');
      }
      handleDaemonStart({ ...options, daemon: true });
    });
}

// --- Internal helpers ---

function handleDaemonStart(options: ConnectOptions) {
  const existingPid = getRunningDaemonPid();
  if (existingPid !== null) {
    log.error(`Daemon is already running (PID ${existingPid}).`);
    log.error("Use 'lh connect stop' to stop it, or 'lh connect restart' to restart.");
    process.exit(1);
  }

  // Build args to re-run with --daemon-child
  const args = buildDaemonArgs(options);
  const pid = spawnDaemon(args);

  log.info(`Daemon started (PID ${pid}).`);
  log.info(`  Logs: ${getLogPath()}`);
  log.info("  Run 'lh connect status' to check connection.");
  log.info("  Run 'lh connect stop' to stop.");
}

function buildDaemonArgs(options: ConnectOptions): string[] {
  // Find the entry script (process.argv[1])
  const script = process.argv[1];
  const args = [script, 'connect'];

  if (options.token) args.push('--token', options.token);
  if (options.gateway) args.push('--gateway', options.gateway);
  if (options.deviceId) args.push('--device-id', options.deviceId);
  if (options.verbose) args.push('--verbose');

  return args;
}

async function runConnect(options: ConnectOptions, isDaemonChild: boolean) {
  let auth = await resolveToken(options);
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

  const resolvedGatewayUrl = gatewayUrl || OFFICIAL_GATEWAY_URL;

  const client = new GatewayClient({
    deviceId: options.deviceId,
    gatewayUrl: resolvedGatewayUrl,
    logger: isDaemonChild ? createDaemonLogger() : log,
    serverUrl: auth.serverUrl,
    token: auth.token,
    tokenType: auth.tokenType,
    userId: auth.userId,
  });

  const info = (msg: string) => {
    if (isDaemonChild) appendLog(msg);
    else log.info(msg);
  };

  const error = (msg: string) => {
    if (isDaemonChild) appendLog(`[ERROR] ${msg}`);
    else log.error(msg);
  };

  // Print device info
  info('─── LobeHub CLI ───');
  info(`  Device ID : ${client.currentDeviceId}`);
  info(`  Hostname  : ${os.hostname()}`);
  info(`  Platform  : ${process.platform}`);
  info(`  Gateway   : ${resolvedGatewayUrl}`);
  info(`  Auth      : ${auth.tokenType}`);
  info(`  Mode      : ${isDaemonChild ? 'daemon' : 'foreground'}`);
  info('───────────────────');

  // Update local connection status so other CLI commands can resolve the current device
  const updateStatus = (connectionStatus: string) => {
    writeStatus({
      connectionStatus,
      deviceId: client.currentDeviceId,
      gatewayUrl: resolvedGatewayUrl,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    });
  };

  const startedAt = new Date();
  updateStatus('connecting');

  // Handle system info requests
  client.on('system_info_request', (request: SystemInfoRequestMessage) => {
    info(`Received system_info_request: requestId=${request.requestId}`);
    const systemInfo = collectSystemInfo();
    client.sendSystemInfoResponse({
      requestId: request.requestId,
      result: { success: true, systemInfo },
    });
  });

  // Handle tool call requests
  client.on('tool_call_request', async (request: ToolCallRequestMessage) => {
    const { requestId, toolCall } = request;
    if (isDaemonChild) {
      appendLog(`[TOOL] ${toolCall.apiName} (${requestId})`);
    } else {
      log.toolCall(toolCall.apiName, requestId, toolCall.arguments);
    }

    const result = await executeToolCall(toolCall.apiName, toolCall.arguments);

    if (isDaemonChild) {
      appendLog(`[RESULT] ${result.success ? 'OK' : 'FAIL'} (${requestId})`);
    } else {
      log.toolResult(requestId, result.success, result.content);
    }

    client.sendToolCallResponse({
      requestId,
      result: {
        content: result.content,
        error: result.error,
        success: result.success,
      },
    });
  });

  client.on('connected', () => {
    updateStatus('connected');
  });

  client.on('disconnected', () => {
    updateStatus('disconnected');
  });

  client.on('reconnecting', () => {
    updateStatus('reconnecting');
  });

  // Proactive token refresh — schedule before JWT expires
  const startProactiveRefresh = () =>
    scheduleProactiveRefresh(
      auth,
      (refreshed) => {
        client.updateToken(refreshed.token);
        auth = refreshed;
        // Schedule next refresh based on the new token
        cancelRefreshTimer = startProactiveRefresh();
      },
      info,
      error,
    );
  let cancelRefreshTimer = startProactiveRefresh();

  // Handle auth failed — attempt token refresh once before giving up
  // (e.g., auto-reconnect may send an expired JWT before proactive refresh fires)
  let authFailedRefreshAttempted = false;
  client.on('auth_failed', async (reason) => {
    if (auth.tokenType === 'jwt' && !authFailedRefreshAttempted) {
      authFailedRefreshAttempted = true;
      info(`Authentication failed (${reason}). Attempting token refresh...`);
      try {
        const refreshed = await resolveToken({});
        if (refreshed && refreshed.token !== auth.token) {
          info('Token refreshed successfully. Reconnecting...');
          client.updateToken(refreshed.token);
          auth = refreshed;
          authFailedRefreshAttempted = false;
          cancelRefreshTimer = startProactiveRefresh();
          await client.reconnect();
          return;
        }
      } catch {
        // fall through
      }
    }

    error(`Authentication failed: ${reason}`);
    error(
      `Run 'lh login', or set ${CLI_API_KEY_ENV} and run 'lh login --server <url>' to configure API key authentication.`,
    );
    cleanup();
    process.exit(1);
  });

  // Handle auth expired — refresh token and reconnect automatically
  client.on('auth_expired', async () => {
    if (auth.tokenType === 'apiKey') {
      // API keys don't expire; ignore stale auth_expired signals
      return;
    }

    info('Authentication expired. Attempting to refresh token...');

    try {
      const refreshed = await resolveToken({});
      if (refreshed) {
        info('Token refreshed successfully. Reconnecting...');
        client.updateToken(refreshed.token);
        auth = refreshed;
        cancelRefreshTimer = startProactiveRefresh();
        await client.reconnect();
        return;
      }
    } catch {
      // refresh failed — fall through
    }

    error("Could not refresh token. Run 'lh login' to re-authenticate.");
    cleanup();
    process.exit(1);
  });

  // Handle errors
  client.on('error', (err) => {
    error(`Connection error: ${err.message}`);
  });

  // Graceful shutdown
  const cleanup = () => {
    info('Shutting down...');
    cancelRefreshTimer?.();
    cleanupAllProcesses();
    client.disconnect();
    removeStatus();
    if (isDaemonChild) {
      removePid();
    }
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
}

function createDaemonLogger() {
  return {
    debug: (msg: string) => appendLog(`[DEBUG] ${msg}`),
    error: (msg: string) => appendLog(`[ERROR] ${msg}`),
    info: (msg: string) => appendLog(`[INFO] ${msg}`),
    warn: (msg: string) => appendLog(`[WARN] ${msg}`),
  };
}

function formatUptime(startedAt: Date): string {
  const diff = Date.now() - startedAt.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// How far before expiry to proactively refresh (1 hour)
const PROACTIVE_REFRESH_BUFFER = 60 * 60;

/**
 * Parse the `exp` claim from a JWT without verifying the signature.
 */
function parseJwtExp(token: string): number | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Schedule a proactive token refresh before the JWT expires.
 * Returns a cleanup function that cancels the scheduled timer.
 */
function scheduleProactiveRefresh(
  auth: { token: string; tokenType: string },
  onRefreshed: (newAuth: Awaited<ReturnType<typeof resolveToken>>) => void,
  info: (msg: string) => void,
  error: (msg: string) => void,
): (() => void) | null {
  if (auth.tokenType !== 'jwt') return null;

  const exp = parseJwtExp(auth.token);
  if (!exp) return null;

  const refreshAt = (exp - PROACTIVE_REFRESH_BUFFER) * 1000;
  const delay = refreshAt - Date.now();

  if (delay < 0) {
    // Already past the refresh window — refresh immediately on next tick
    void doRefresh();
    return null;
  }

  const timer = setTimeout(() => void doRefresh(), delay);
  return () => clearTimeout(timer);

  async function doRefresh() {
    try {
      // Use the same buffer so getValidToken actually triggers a refresh
      const result = await getValidToken(PROACTIVE_REFRESH_BUFFER);
      if (!result) {
        error('Proactive token refresh failed — no valid credentials.');
        return;
      }

      const refreshed = await resolveToken({});
      // Only notify if the token actually changed to avoid reschedule loops
      if (refreshed.token !== auth.token) {
        info('Proactively refreshed token.');
        onRefreshed(refreshed);
      }
    } catch {
      error('Proactive token refresh failed.');
    }
  }
}

function collectSystemInfo(): DeviceSystemInfo {
  const home = os.homedir();
  const platform = process.platform;
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
