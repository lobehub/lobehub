import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defaultGetLocalFilePreview,
  defaultGetProjectFileIndex,
  type DeviceControlDeps,
  executeDeviceRpc,
} from '@lobechat/device-control';
import type {
  AgentRunRequestMessage,
  DeviceSystemInfo,
  RpcRequestMessage,
  SystemInfoRequestMessage,
  ToolCallRequestMessage,
} from '@lobechat/device-gateway-client';
import { GatewayClient } from '@lobechat/device-gateway-client';
import type { Command } from 'commander';

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
import { spawnHeteroAgentRun } from '../device/agentRun';
import {
  mintWorkspaceConnectToken,
  registerDevice,
  registerWorkspaceDevice,
  resolveDeviceIdentity,
  resolveWorkspaceDeviceIdentity,
} from '../device/register';
import { loadOrCreateConnectionId, loadSettings, normalizeUrl, saveSettings } from '../settings';
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
  /** Enroll this machine as a device of the given workspace (admin only). */
  workspace?: string;
}

export function registerConnectCommand(program: Command) {
  const connectCmd = program
    .command('connect')
    .description('Connect to the device gateway and listen for tool calls')
    .option('--token <jwt>', 'JWT access token')
    .option('--gateway <url>', 'Device gateway URL')
    .option('--device-id <id>', 'Device ID (auto-generated if not provided)')
    .option('--workspace <id>', 'Enroll as a device of this workspace (admin only)')
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
  connectCmd.command('stop').description('Stop the background daemon process').action(handleStop);

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

  // Top-level alias for `connect stop`. Users who run `lh connect` naturally
  // reach for `lh disconnect` to undo it; the nested `connect stop` is not
  // discoverable enough on its own.
  program
    .command('disconnect')
    .description('Disconnect from the device gateway (alias for `connect stop`)')
    .action(handleStop);
}

// --- Internal helpers ---

function handleStop() {
  const stopped = stopDaemon();
  if (stopped) {
    log.info('Daemon stopped.');
  } else {
    log.warn('No daemon is running.');
  }
}

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
  if (options.workspace) args.push('--workspace', options.workspace);
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

  // Workspace enrollment: the device joins a workspace pool (reachable by all
  // members) instead of the personal pool. It authenticates with a minted
  // workspace-device token (carrying the `workspace_id` claim) and uses a
  // workspace-derived deviceId. `auth` stays the admin's identity — used only to
  // (re-)mint the connect token and register the row.
  const workspaceId = options.workspace;

  // Resolve a stable device identity. An explicit `--device-id` wins (lets a
  // user pin a VM to a fixed identity); otherwise derive from the machine id so
  // the same machine maps to one device across reconnects.
  const identity = workspaceId
    ? resolveWorkspaceDeviceIdentity(workspaceId, options.deviceId)
    : resolveDeviceIdentity(auth.userId, options.deviceId);

  // The token the gateway socket authenticates with. Re-minted on refresh for
  // workspace devices (see `refreshConnectToken`).
  let connectToken = auth.token;
  let connectTokenType: 'apiKey' | 'jwt' | 'serviceToken' = auth.tokenType;
  if (workspaceId) {
    const minted = await mintWorkspaceConnectToken(auth, workspaceId);
    connectToken = minted.token;
    connectTokenType = 'jwt';
  }

  // Re-resolve the admin auth and, for workspace mode, re-mint the connect token.
  const refreshConnectToken = async (): Promise<string | undefined> => {
    const refreshed = await resolveToken({});
    if (!refreshed) return undefined;
    auth = refreshed;
    if (workspaceId) {
      const minted = await mintWorkspaceConnectToken(auth, workspaceId);
      connectToken = minted.token;
      return connectToken;
    }
    connectToken = refreshed.token;
    return connectToken;
  };

  // Freeform channel label (`cli` by default); `LOBEHUB_CLI_CHANNEL` lets a
  // dev build tag itself `cli-dev` so the gateway can prioritise / display it.
  const channel = process.env.LOBEHUB_CLI_CHANNEL || 'cli';

  const client = new GatewayClient({
    channel,
    connectionId: loadOrCreateConnectionId(),
    deviceId: identity?.deviceId ?? options.deviceId,
    gatewayUrl: resolvedGatewayUrl,
    logger: isDaemonChild ? createDaemonLogger() : log,
    serverUrl: auth.serverUrl,
    token: connectToken,
    tokenType: connectTokenType,
    userId: workspaceId ? undefined : auth.userId,
    workspaceId,
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
    const { operationId, requestId, timeout, toolCall } = request;
    if (isDaemonChild) {
      appendLog(
        `[TOOL] ${toolCall.apiName}${operationId ? ` op=${operationId}` : ''} (${requestId})`,
      );
    } else {
      log.toolCall(toolCall.apiName, requestId, toolCall.arguments, operationId);
    }

    const result = await executeToolCall(toolCall.apiName, toolCall.arguments, timeout);

    if (isDaemonChild) {
      appendLog(
        `[RESULT] ${result.success ? 'OK' : 'FAIL'}${operationId ? ` op=${operationId}` : ''} (${requestId})`,
      );
    } else {
      log.toolResult(requestId, result.success, result.content, operationId);
    }

    client.sendToolCallResponse({
      requestId,
      result: {
        content: result.content,
        error: result.error,
        state: result.state,
        success: result.success,
      },
    });
  });

  // Handle generic server-internal device RPCs (git / workspace / file ops).
  // Shares the `@lobechat/device-control` dispatcher with the desktop app so the
  // CLI exposes the same remote-device control surface. File preview / index use
  // the package's portable defaults (no preview-protocol approval on the CLI).
  const deviceControlDeps: DeviceControlDeps = {
    getLocalFilePreview: defaultGetLocalFilePreview,
    getProjectFileIndex: defaultGetProjectFileIndex,
  };

  client.on('rpc_request', async (request: RpcRequestMessage) => {
    const { method, params, requestId } = request;
    if (isDaemonChild) appendLog(`[RPC] ${method} (${requestId})`);
    else info(`Received rpc_request: method=${method} (${requestId})`);

    try {
      const data = await executeDeviceRpc(method, params, deviceControlDeps);
      client.sendRpcResponse({ requestId, result: { data, success: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isDaemonChild) appendLog(`[RPC ERROR] ${method}: ${message} (${requestId})`);
      else error(`rpc_request method=${method} failed: ${message}`);
      client.sendRpcResponse({ requestId, result: { error: message, success: false } });
    }
  });

  // Handle gateway-dispatched agent runs (heterogeneous agents, e.g. Claude
  // Code). Mirrors the desktop app: spawn `lh hetero exec`, which owns the full
  // execution + server-ingest pipeline. Ack with the spawn outcome — `accepted`
  // once the child starts, `rejected` if it fails to spawn (e.g. bad cwd) — so
  // a failed dispatch surfaces as an error instead of a stuck assistant message.
  client.on('agent_run_request', async (request: AgentRunRequestMessage) => {
    info(
      `Received agent_run_request: operationId=${request.operationId} type=${request.agentType}`,
    );
    try {
      const ack = await spawnHeteroAgentRun(
        {
          agentType: request.agentType,
          args: request.args,
          cwd: request.cwd,
          imageList: request.imageList,
          jwt: request.jwt,
          operationId: request.operationId,
          prompt: request.prompt,
          resumeSessionId: request.resumeSessionId,
          serverUrl: auth.serverUrl,
          systemContext: request.systemContext,
          topicId: request.topicId,
        },
        { error, info },
      );
      client.sendAgentRunAck({ operationId: request.operationId, ...ack });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      error(`agent_run_request failed: ${reason}`);
      client.sendAgentRunAck({ operationId: request.operationId, reason, status: 'rejected' });
    }
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

  // Proactive token refresh — schedule before the connect token expires. For a
  // workspace device `refreshConnectToken` re-mints the workspace token; for a
  // personal device it refreshes the user token. Scheduling watches the actual
  // connect token, so the workspace token's shorter life is respected.
  const startProactiveRefresh = (): (() => void) | null =>
    scheduleProactiveRefresh(
      connectToken,
      connectTokenType,
      async () => {
        const newToken = await refreshConnectToken();
        if (newToken) {
          client.updateToken(newToken);
          cancelRefreshTimer = startProactiveRefresh();
        }
        return newToken;
      },
      info,
      error,
    );
  let cancelRefreshTimer = startProactiveRefresh();

  // Handle auth failed — attempt token refresh once before giving up
  // (e.g., auto-reconnect may send an expired JWT before proactive refresh fires)
  let authFailedRefreshAttempted = false;
  client.on('auth_failed', async (reason) => {
    if (connectTokenType === 'jwt' && !authFailedRefreshAttempted) {
      authFailedRefreshAttempted = true;
      info(`Authentication failed (${reason}). Attempting token refresh...`);
      try {
        const prev = connectToken;
        const newToken = await refreshConnectToken();
        if (newToken && newToken !== prev) {
          info('Token refreshed successfully. Reconnecting...');
          client.updateToken(newToken);
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
    if (connectTokenType === 'apiKey') {
      // API keys don't expire; ignore stale auth_expired signals
      return;
    }

    info('Authentication expired. Attempting to refresh token...');

    try {
      const newToken = await refreshConnectToken();
      if (newToken) {
        info('Token refreshed successfully. Reconnecting...');
        client.updateToken(newToken);
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

  // Register this device in the server registry before opening the WS, so the
  // row exists by the time the gateway reports it online. `lh login` already
  // registers, but re-running here is cheap (idempotent upsert) and covers
  // `--token` sessions that never went through login. Best-effort: a failure
  // must not block the connection.
  if (identity) {
    try {
      // Reuse the already-resolved auth (respects `--token` mode) so we don't
      // re-discover creds and exit when none are found.
      if (workspaceId) await registerWorkspaceDevice(auth, identity, workspaceId);
      else await registerDevice(auth, identity);
    } catch (err) {
      error(`Device registration failed (non-fatal): ${(err as Error).message}`);
    }
  }

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
 * Schedule a proactive token refresh before the (connect) token expires.
 * `refresh` performs the actual refresh — re-minting a workspace token or
 * refreshing the user token — and returns the new token. Returns a cleanup
 * function that cancels the scheduled timer.
 */
function scheduleProactiveRefresh(
  token: string,
  tokenType: string,
  refresh: () => Promise<string | undefined>,
  info: (msg: string) => void,
  error: (msg: string) => void,
): (() => void) | null {
  if (tokenType !== 'jwt') return null;

  const exp = parseJwtExp(token);
  if (!exp) return null;

  const lifetimeMs = exp * 1000 - Date.now();
  if (lifetimeMs <= 0) {
    // Token already expired — refresh once on next tick.
    void doRefresh();
    return null;
  }

  // Refresh ahead of expiry, but never let the buffer meet or exceed the token's
  // remaining lifetime: a buffer >= lifetime collapses the refresh window to <=0
  // and busy-loops re-minting (e.g. a 1h token with a 1h buffer). Cap the buffer
  // at half the remaining lifetime so a short-lived token refreshes about once per
  // half-life instead of spinning.
  const bufferMs = Math.min(PROACTIVE_REFRESH_BUFFER * 1000, lifetimeMs / 2);
  const delay = lifetimeMs - bufferMs;

  const timer = setTimeout(() => void doRefresh(), delay);
  return () => clearTimeout(timer);

  async function doRefresh() {
    try {
      const newToken = await refresh();
      if (!newToken) {
        error('Proactive token refresh failed — no valid credentials.');
        return;
      }
      if (newToken !== token) info('Proactively refreshed token.');
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
