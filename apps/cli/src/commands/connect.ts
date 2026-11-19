import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

import type {
  GatewayIdentityProvider,
  GatewayIdentityResponse,
} from '@lobechat/agent-gateway-client';
import {
  defaultGetLocalFilePreview,
  defaultGetProjectFileIndex,
  defaultSearchProjectFiles,
  type DeviceControlDeps,
  DeviceMetricsSampler,
  pushMetrics,
} from '@lobechat/device-control';
import { GatewayClient } from '@lobechat/device-gateway-client';
import { listHeterogeneousAgentModels } from '@lobechat/heterogeneous-agents/models';
import { createRuntimeProbeCache } from '@lobechat/heterogeneous-agents/runtimeProbeCache';
import type { Command } from 'commander';

import { createLambdaClient } from '../api/client';
import {
  createGatewayIdentityProvider,
  isGatewayIdentityRetryable,
  workspaceAdminRequiredMessage,
} from '../auth/gatewayIdentity';
import { resolveToken } from '../auth/resolveToken';
import { pickAuthSource } from '../auth/source';
import { CLI_CONNECT_SERVICE_NAME, CLI_DISPLAY_NAME, CLI_PRIMARY_BIN } from '../constants/identity';
import { CliMaintenance } from '../daemon/maintenance';
import {
  appendLog,
  getLogPath,
  getRunningDaemonPid,
  isProcessAlive,
  readStatus,
  removePid,
  removeStatus,
  reportDaemonStartupReady,
  spawnDaemon,
  stopDaemon,
  writeStatus,
} from '../daemon/manager';
import { listTasks } from '../daemon/taskRegistry';
import {
  describeDeviceGateway,
  describeDeviceGatewayFailure,
  rememberGatewayOverride,
  resolveCliDeviceGateway,
} from '../device/gatewayEndpoint';
import { bindGatewayClientHandlers, type GatewayHandlerContext } from '../device/gatewayHandlers';
import {
  registerDevice,
  registerWorkspaceDevice,
  resolveDeviceIdentity,
  resolveWorkspaceDeviceIdentity,
} from '../device/register';
import { probeNativeRuntimes } from '../device/systemInfo';
import { TerminalSessionManager } from '../device/terminal';
import {
  CONNECT_RETRYABLE_EXIT_CODE,
  getWorkspaceFailureExitCode,
  installConnectService,
  readConnectServiceStatus,
  restartConnectService,
  startConnectService,
  stopConnectService,
  uninstallConnectService,
} from '../service/connect';
import {
  addWorkspaceEnrollment,
  loadOrCreateConnectionId,
  loadWorkspaceEnrollments,
  removeWorkspaceEnrollment,
  resolveCommandMode,
  resolveDeviceMetricsBacklogPath,
  resolveServerUrl,
} from '../settings';
import { cleanupAllProcesses, getActiveShellCount, probeSandbox } from '../tools/shell';
import { log, setVerbose } from '../utils/logger';
import { sweepLocalTraces } from '../utils/traceMaintenance';

/** Longest a clean stop waits to push pending device health samples. */
const SHUTDOWN_METRICS_FLUSH_MS = 3000;
const CONNECT_SERVICE_NAME = CLI_CONNECT_SERVICE_NAME;

interface ConnectOptions {
  daemon?: boolean;
  daemonChild?: boolean;
  deviceId?: string;
  gateway?: string;
  /** With --workspace: enroll into the shared pool visible to every member (default: private). */
  public?: boolean;
  serviceChild?: boolean;
  token?: string;
  verbose?: boolean;
  /** Enroll this machine as a device of the given workspace (workspace members). */
  workspace?: string;
}

export function registerConnectCommand(program: Command) {
  const connectCmd = program
    .command('connect')
    .description('Connect to the device gateway and listen for tool calls')
    .option('--token <jwt>', 'JWT access token')
    .option('--gateway <url>', 'Device gateway URL')
    .option('--device-id <id>', 'Device ID (auto-generated if not provided)')
    .option('--workspace <id>', 'Enroll as a device of this workspace (workspace administrators)')
    .option(
      '--public',
      'With --workspace: enroll into the shared pool visible to every member (default: private, visible only to you)',
    )
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-d, --daemon', 'Run as a background daemon process')
    .option('--daemon-child', 'Internal: runs as the daemon child process')
    .option('--service-child', 'Internal: runs as the system service child process')
    .action(async (options: ConnectOptions) => {
      if (options.verbose) setVerbose(true);

      // --daemon: spawn detached child and exit
      if (options.daemon) {
        return handleDaemonStart(options);
      }

      const isServiceChild = options.serviceChild || process.env.LOBEHUB_CONNECT_SERVICE === '1';
      const isDaemonChild =
        options.daemonChild || isServiceChild || process.env.LOBEHUB_DAEMON === '1';

      await runConnect(options, isDaemonChild);
    });

  // Capability discovery runs without login or opening a gateway connection. Desktop
  // invokes its bundled CLI here so the probe and subsequent dispatch share a runtime.
  connectCmd
    .command('capabilities')
    .description('Report native agent runtimes supported by this CLI and installed binaries')
    .action(async () => {
      console.log(JSON.stringify({ supportedAgentRuntimes: await probeNativeRuntimes() }));
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
        log.info(`  Gateway          : ${formatStatusGateway(status)}`);
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
    .action(async (options: ConnectOptions) => {
      const wasStopped = stopDaemon();
      if (wasStopped) {
        log.info('Stopped existing daemon.');
      }
      await handleDaemonStart({ ...options, daemon: true });
    });

  const serviceCmd = connectCmd
    .command('service')
    .description('Manage the Linux user systemd connect service');

  serviceCmd
    .command('install')
    .description('Install and start the Linux user systemd connect service')
    .option('--workspace <id>', 'Enroll as a device of this workspace (workspace administrators)')
    .option(
      '--public',
      'With --workspace: enroll into the shared pool visible to every member (default: private, visible only to you)',
    )
    .action((options: Pick<ConnectOptions, 'public' | 'workspace'>) => {
      installConnectService({ public: options.public, workspace: options.workspace });
      log.info(
        options.workspace
          ? `Installed and started ${CONNECT_SERVICE_NAME} for workspace ${options.workspace}.`
          : `Installed and started ${CONNECT_SERVICE_NAME}.`,
      );
      log.info("Run 'lh connect service status' to inspect the service.");
    });

  serviceCmd
    .command('uninstall')
    .description('Remove the Linux user systemd connect service')
    .action(() => {
      const removed = uninstallConnectService();
      if (removed) log.info(`Uninstalled ${CONNECT_SERVICE_NAME}.`);
      else log.warn('No connect service is installed.');
    });

  serviceCmd
    .command('start')
    .description('Start the installed connect service')
    .action(() => {
      const started = startConnectService();
      if (started) log.info(`Started ${CONNECT_SERVICE_NAME}.`);
      else log.warn('No connect service is installed.');
    });

  serviceCmd
    .command('stop')
    .description('Stop the installed connect service')
    .action(() => {
      const stopped = stopConnectService();
      if (stopped) log.info(`Stopped ${CONNECT_SERVICE_NAME}.`);
      else log.warn('No connect service is installed.');
    });

  serviceCmd
    .command('restart')
    .description('Restart the installed connect service')
    .action(() => {
      const restarted = restartConnectService();
      if (restarted) log.info(`Restarted ${CONNECT_SERVICE_NAME}.`);
      else log.warn('No connect service is installed.');
    });

  serviceCmd
    .command('status')
    .description('Show the installed connect service status')
    .action(() => {
      const serviceStatus = readConnectServiceStatus();
      if (!serviceStatus) {
        log.info('No connect service is installed.');
        return;
      }

      const status = readStatus();
      log.info('─── Connect Service Status ───');
      log.info(`  Service          : ${serviceStatus.serviceName}`);
      log.info(`  Installed        : yes`);
      log.info(`  Enabled          : ${serviceStatus.enabled ? 'yes' : 'no'}`);
      log.info(`  Active           : ${serviceStatus.active ? 'yes' : 'no'}`);
      log.info(`  Sub-state        : ${serviceStatus.subState || 'unknown'}`);
      if (serviceStatus.mainPid !== null) {
        log.info(`  PID              : ${serviceStatus.mainPid}`);
      }
      if (status) {
        log.info(`  Connection       : ${status.connectionStatus}`);
        log.info(`  Gateway          : ${formatStatusGateway(status)}`);
        const uptime = formatUptime(new Date(status.startedAt));
        log.info(`  Uptime           : ${uptime}`);
      }
      log.info('──────────────────────────────');
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

async function handleDaemonStart(options: ConnectOptions) {
  const existingPid = getRunningDaemonPid();
  if (existingPid !== null) {
    log.error(`Daemon is already running (PID ${existingPid}).`);
    log.error("Use 'lh connect stop' to stop it, or 'lh connect restart' to restart.");
    process.exit(1);
  }

  // Build args to re-run with --daemon-child
  const args = buildDaemonArgs(options);
  const pid = await spawnDaemon(args);

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
  if (options.public) args.push('--public');
  if (options.verbose) args.push('--verbose');

  return args;
}

async function runConnect(options: ConnectOptions, isDaemonChild: boolean) {
  // Fail before connecting when the configured command fence cannot be
  // honored; an online daemon that refuses every command looks healthy while
  // hiding the actual configuration problem in per-command errors.
  const commandMode = resolveCommandMode();
  if (commandMode === 'sandbox') {
    const capability = await probeSandbox();
    if (!capability.available) {
      log.error(
        `This device is configured to run every command sandboxed, but the sandbox is unavailable: ${capability.reason ?? 'unsupported host'}.`,
      );
      log.error(
        `Provision the sandbox, or run '${CLI_PRIMARY_BIN} config set command-mode auto' to honour each run's own setting instead.`,
      );
      process.exit(1);
      throw new Error('process.exit');
    }
  }

  const unavailableExitCode = options.workspace ? CONNECT_RETRYABLE_EXIT_CODE : undefined;
  const auth = await resolveToken({ ...options, unavailableExitCode });

  const info = (msg: string) => {
    if (isDaemonChild) appendLog(msg);
    else log.info(msg);
  };

  const error = (msg: string) => {
    if (isDaemonChild) appendLog(`[ERROR] ${msg}`);
    else log.error(msg);
  };

  // Resolved once per process, against the server the token belongs to. The
  // client's own reconnects and every workspace share connection reuse it.
  const gateway = await resolveCliDeviceGateway({
    override: options.gateway,
    serverUrl: auth.serverUrl,
  });
  if (!gateway.ok) {
    const { detail, fix } = describeDeviceGatewayFailure(gateway, auth.serverUrl);
    // Thrown, so a daemon parent reports it as the startup error too.
    throw new Error(`${detail} ${fix}`);
  }
  const resolvedGatewayUrl = gateway.endpoint.url;
  const gatewayDescription = describeDeviceGateway(gateway.endpoint);
  if (rememberGatewayOverride(auth.serverUrl, gateway.endpoint)) {
    info(
      `Saved ${resolvedGatewayUrl} as the device gateway for ${auth.serverUrl}; later runs use it ahead of the server's own address.`,
    );
  }

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
    ? resolveWorkspaceDeviceIdentity(workspaceId, options.deviceId, loadOrCreateConnectionId())
    : resolveDeviceIdentity(auth.userId, options.deviceId);

  let active = true;
  const source = pickAuthSource(options);
  const isCurrent = () =>
    active &&
    resolveServerUrl() === auth.serverUrl &&
    pickAuthSource(options).kind === source.kind &&
    pickAuthSource(options).token === source.token;
  const provider = createGatewayIdentityProvider(auth, { workspaceId, isCurrent });
  // The device and connection the ticket will name: Work signs exactly these,
  // and the client below connects as the same pair.
  const deviceId = identity?.deviceId ?? options.deviceId ?? randomUUID();
  const connectionId = loadOrCreateConnectionId();
  let initial: GatewayIdentityResponse | undefined;
  try {
    initial = await provider({ connectionId, deviceId, signal: new AbortController().signal });
  } catch (err) {
    log.error(
      workspaceId && (err as { code?: string }).code === 'FORBIDDEN'
        ? workspaceAdminRequiredMessage
        : `Gateway identity failed: ${(err as Error).message}`,
    );
    process.exit(workspaceId && isGatewayIdentityRetryable(err) ? CONNECT_RETRYABLE_EXIT_CODE : 1);
    return;
  }
  const enrollmentScope = JSON.stringify([auth.serverUrl, initial.tenantId, initial.userId]);
  const identityProvider = async (input: Parameters<GatewayIdentityProvider>[0]) => {
    input.signal.throwIfAborted();
    if (!isCurrent()) throw new Error('GATEWAY_IDENTITY_CHANGED');
    if (initial) {
      const first = initial;
      initial = undefined;
      return first;
    }
    return provider(input);
  };

  // Freeform channel label (`cli` by default); `LOBEHUB_CLI_CHANNEL` lets a
  // dev build tag itself `cli-dev` so the gateway can prioritise / display it.
  const channel = process.env.LOBEHUB_CLI_CHANNEL || 'cli';

  const client = new GatewayClient({
    channel,
    connectionId,
    deviceId,
    gatewayUrl: resolvedGatewayUrl,
    identityProvider,
    tunnel: false,
    logger: isDaemonChild ? createDaemonLogger() : log,
    serverUrl: auth.serverUrl,
    token: initial.gatewayTicket,
    tokenType: 'jwt',
    userId: workspaceId ? undefined : auth.userId,
    workspaceId,
  });

  // Print device info
  info(`─── ${CLI_DISPLAY_NAME} ───`);
  info(`  Device ID : ${client.currentDeviceId}`);
  info(`  Hostname  : ${os.hostname()}`);
  info(`  Platform  : ${process.platform}`);
  info(`  Gateway   : ${gatewayDescription}`);
  info(`  Auth      : ${auth.tokenType}`);
  info(`  Mode      : ${isDaemonChild ? 'daemon' : 'foreground'}`);
  info('───────────────────');

  // Update local connection status so other CLI commands can resolve the current device
  let connectionStatus = 'connecting';
  let lastRequestAt: string | undefined;
  const updateStatus = (status: string) => {
    connectionStatus = status;
    writeStatus({
      connectionStatus,
      deviceId: client.currentDeviceId,
      gatewaySource: gateway.endpoint.source,
      gatewayUrl: resolvedGatewayUrl,
      lastRequestAt,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    });
  };
  const recordRequest = () => {
    lastRequestAt = new Date().toISOString();
    updateStatus(connectionStatus);
  };

  const startedAt = new Date();
  updateStatus('connecting');

  // Housekeeping for the local trace store: partials left behind by killed
  // agent processes become `interrupted` snapshots (so `lh trace op list` shows
  // the crashed runs), and aged-out snapshots are deleted. Fire-and-forget —
  // it must never delay the gateway connection.
  void sweepLocalTraces().then(({ deleted, reconciled }) => {
    if (reconciled > 0 || deleted > 0) {
      info(`  Traces    : ${reconciled} interrupted run(s) closed, ${deleted} expired removed`);
    }
  });

  // Platform handlers for the shared `@lobechat/device-control` dispatcher.
  // File preview / index use the package's portable defaults (no
  // preview-protocol approval on the CLI). Deliberately mutable: the
  // mode-specific `enrollWorkspace` / `unenrollWorkspace` handlers are attached
  // further below once the workspace-share machinery is in scope — every bound
  // connection reads this object by reference, so late attachment is safe.
  //
  // Interactive shells for the remote terminal. One manager per process, read
  // by reference by every gateway connection this daemon owns, so a
  // workspace-share connection reaches the same sessions as the personal one.
  // Constructing it is cheap — the native PTY binding is only loaded when a
  // session is actually created, so a daemon that never opens a terminal never
  // touches it.
  const terminals = new TerminalSessionManager({ logger: { warn: (message) => info(message) } });

  const maintenance = new CliMaintenance({
    activeTasks: () =>
      getActiveShellCount() + listTasks().filter((task) => isProcessAlive(task.pid)).length,
    daemon:
      !!options.daemonChild && !options.serviceChild && process.env.LOBEHUB_CONNECT_SERVICE !== '1',
    restartArgs: buildDaemonArgs(options).slice(1),
    shutdown: () => shutdown(),
  });

  const deviceControlDeps: DeviceControlDeps = {
    checkCliUpdate: maintenance.check,
    closeTerminal: (params) => Promise.resolve(terminals.close(params)),
    createTerminalSession: (params) => terminals.create(params),
    getCliUpdateState: maintenance.getState,
    getLocalFilePreview: defaultGetLocalFilePreview,
    getProjectFileIndex: defaultGetProjectFileIndex,
    listHeterogeneousAgentModels: (params) =>
      listHeterogeneousAgentModels({
        ...params,
        env: Object.fromEntries(
          Object.entries({ ...process.env, ...params.env }).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
      }),
    readTerminal: (params) => Promise.resolve(terminals.read(params)),
    resizeTerminal: (params) => Promise.resolve(terminals.resize(params)),
    restartCli: maintenance.restart,
    searchProjectFiles: defaultSearchProjectFiles,
    writeTerminal: (params) => Promise.resolve(terminals.write(params)),
  };

  // One native runtime probe per connection: system info is queried by tool runs and
  // agent dispatch alike, and each probe starts a Codex app-server process.
  const nativeRuntimes = createRuntimeProbeCache(probeNativeRuntimes);

  const handlerContext: GatewayHandlerContext = {
    deps: deviceControlDeps,
    error,
    // Read at dispatch time — `auth` may be refreshed mid-session.
    getAuth: () => auth,
    info,
    isDaemonChild,
    maintenance,
    nativeRuntimes,
    recordRequest,
  };

  // Request handlers (system info / tool calls / device RPCs / agent runs) —
  // shared with the workspace-share connections opened via `enrollWorkspace`.
  bindGatewayClientHandlers(client, handlerContext, workspaceId);

  // Machine health (CPU / memory / load) for the device page. Samples go to
  // the device gateway over this socket (the gateway is their only store);
  // they keep accruing while disconnected and upload once the connection is
  // back, so the stretch around a drop is visible afterwards. Each batch is
  // mirrored to this machine's workspace-share connections so a shared
  // device's workspace row has the same history.
  const deviceMetricsSupported = false;
  const metricsSampler =
    deviceMetricsSupported && identity
      ? new DeviceMetricsSampler({
          isConnected: () => client.connectionStatus === 'connected',
          logger: { warn: (msg) => info(msg) },
          storagePath: resolveDeviceMetricsBacklogPath(identity.deviceId),
          upload: (samples) =>
            pushMetrics(
              client,
              [...workspaceConnections.values()].map((entry) => entry.client),
              samples,
            ),
        })
      : undefined;

  client.on('connected', () => {
    updateStatus('connected');
    void metricsSampler?.flush();
    if (!workspaceId) void restoreWorkspaceEnrollments();
    // A (re)connection reprobes so an upgraded or downgraded Codex is reported, and
    // warms the cache before the gateway's first system_info_request.
    nativeRuntimes.invalidate();
    void nativeRuntimes.get();
  });

  client.on('disconnected', () => {
    updateStatus('disconnected');
  });

  client.on('reconnecting', () => {
    updateStatus('reconnecting');
  });

  // ─── Workspace share connections (personal mode) ───
  //
  // The server shares this personal device into a workspace by sending an
  // `enrollWorkspace` RPC over the PERSONAL connection. The process then keeps a
  // second gateway connection per shared workspace, authenticated with a minted
  // workspace-device connect token and identified by the workspace-derived
  // deviceId — so the machine is simultaneously reachable as a personal device
  // and as a device of each shared workspace.

  interface WorkspaceShareConnection {
    cancelRefresh: (() => void) | null;
    client: GatewayClient;
  }

  const workspaceConnections = new Map<string, WorkspaceShareConnection>();
  const workspaceDials = new Map<string, AbortController>();

  const closeWorkspaceConnection = (wsId: string) => {
    workspaceDials.get(wsId)?.abort();
    workspaceDials.delete(wsId);
    const entry = workspaceConnections.get(wsId);
    if (!entry) return;
    workspaceConnections.delete(wsId);
    entry.cancelRefresh?.();
    entry.client.disconnect();
  };

  const openWorkspaceConnection = async (wsId: string, initialToken?: string) => {
    // Re-enroll replaces the previous share connection instead of stacking one.
    closeWorkspaceConnection(wsId);
    if (!isCurrent()) throw new Error('GATEWAY_IDENTITY_CHANGED');
    const dial = new AbortController();
    workspaceDials.set(wsId, dial);
    const provider = createGatewayIdentityProvider(auth, {
      workspaceId: wsId,
      initialTicket: initialToken,
      isCurrent,
    });
    // Same derivation as `lh connect --workspace` so the enroll RPC and a manual
    // workspace enrollment on this machine resolve to one workspace device.
    const wsIdentity = resolveWorkspaceDeviceIdentity(wsId, undefined, loadOrCreateConnectionId());
    let first: GatewayIdentityResponse | undefined;
    try {
      first = await provider({
        connectionId: loadOrCreateConnectionId(),
        deviceId: wsIdentity.deviceId,
        signal: dial.signal,
      });
    } catch (err) {
      if (workspaceDials.get(wsId) === dial) workspaceDials.delete(wsId);
      dial.abort();
      if ((err as { code?: string }).code === 'FORBIDDEN')
        throw new Error(workspaceAdminRequiredMessage, { cause: err });
      throw err;
    }
    if (!isCurrent() || dial.signal.aborted) throw new Error('GATEWAY_IDENTITY_CHANGED');
    const shareProvider = async (input: Parameters<GatewayIdentityProvider>[0]) => {
      input.signal.throwIfAborted();
      dial.signal.throwIfAborted();
      if (!isCurrent()) throw new Error('GATEWAY_IDENTITY_CHANGED');
      if (first) {
        const result = first;
        first = undefined;
        return result;
      }
      return provider(input);
    };

    const wsClient = new GatewayClient({
      channel,
      connectionId: loadOrCreateConnectionId(),
      deviceId: wsIdentity.deviceId,
      gatewayUrl: resolvedGatewayUrl,
      identityProvider: shareProvider,
      tunnel: false,
      logger: isDaemonChild ? createDaemonLogger() : log,
      serverUrl: auth.serverUrl,
      token: first.gatewayTicket,
      tokenType: 'jwt',
      userId: undefined,
      workspaceId: wsId,
    });

    bindGatewayClientHandlers(wsClient, handlerContext, wsId);

    const entry: WorkspaceShareConnection = { cancelRefresh: null, client: wsClient };

    wsClient.on('auth_expired', () => {
      if (isCurrent() && workspaceConnections.get(wsId) === entry) void wsClient.reconnect();
    });

    wsClient.on('replaced', () => {
      error(
        `Workspace ${wsId} share connection was taken over by another '${CLI_PRIMARY_BIN} connect' on this machine. Closing it here.`,
      );
      closeWorkspaceConnection(wsId);
    });

    wsClient.on('auth_failed', (reason) => {
      // Only this share connection is affected — never exit the personal process.
      error(
        reason === 'FORBIDDEN'
          ? workspaceAdminRequiredMessage
          : `Workspace ${wsId} authentication failed: ${reason}. Closing share connection.`,
      );
      closeWorkspaceConnection(wsId);
    });

    wsClient.on('error', (err) => {
      error(`Workspace ${wsId} connection error: ${err.message}`);
    });

    workspaceConnections.set(wsId, entry);
    await wsClient.connect();
    return wsIdentity;
  };

  if (workspaceId) {
    // Workspace-mode process (`lh connect --workspace <id>`): an unenroll for
    // our own workspace means the server revoked this enrollment — ack, then
    // exit gracefully so a daemon stops reconnecting as a ghost device.
    deviceControlDeps.unenrollWorkspace = async (params) => {
      if (params.workspaceId !== workspaceId) {
        throw new Error(
          `This connection is enrolled to workspace ${workspaceId}, not ${params.workspaceId}`,
        );
      }
      info('Workspace enrollment was revoked by the server. Shutting down...');
      // Delay the teardown so the RPC response flushes before the socket closes.
      setTimeout(() => {
        cleanup();
        process.exit(0);
      }, 500);
      return { success: true };
    };
  } else {
    deviceControlDeps.enrollWorkspace = async ({
      identityOnly,
      token: wsToken,
      workspaceId: wsId,
    }) => {
      // Dry-run probe: hand the server our derived identity so it can detect
      // an existing enrollment (and ask for overwrite confirmation) without
      // this machine opening or persisting anything.
      if (identityOnly)
        return resolveWorkspaceDeviceIdentity(wsId, undefined, loadOrCreateConnectionId());
      const wsIdentity = await openWorkspaceConnection(wsId, wsToken);
      // Persist so a restart re-opens the share connection without the server
      // having to re-share. The server registers the device row itself from
      // the identity we return.
      addWorkspaceEnrollment(wsId, enrollmentScope);
      info(`Enrolled into workspace ${wsId} as device ${wsIdentity.deviceId}`);
      return wsIdentity;
    };

    // The revoke instruction may arrive on the workspace connection (preferred)
    // or on the personal one — both bind the same deps, so either path lands here.
    deviceControlDeps.unenrollWorkspace = async ({ workspaceId: wsId }) => {
      closeWorkspaceConnection(wsId);
      removeWorkspaceEnrollment(wsId, enrollmentScope);
      info(`Unenrolled from workspace ${wsId}`);
      return { success: true };
    };
  }

  /**
   * Re-open share connections persisted by a previous run. Before reconnecting,
   * confirm our derived workspace deviceId still has a registered row — the
   * share may have been revoked while this device was offline (the server can't
   * deliver `unenrollWorkspace` to a dead socket), and reconnecting anyway would
   * resurrect the device as a ghost in the workspace pool.
   */
  let workspaceRestoreInFlight = false;
  const restoreWorkspaceEnrollments = async () => {
    if (workspaceRestoreInFlight) return;
    workspaceRestoreInFlight = true;
    try {
      for (const wsId of loadWorkspaceEnrollments(enrollmentScope)) {
        if (!isCurrent()) return;
        if (workspaceConnections.has(wsId) || workspaceDials.has(wsId)) continue;
        try {
          const wsIdentity = resolveWorkspaceDeviceIdentity(
            wsId,
            undefined,
            loadOrCreateConnectionId(),
          );
          const trpc = createLambdaClient(auth, wsId);
          const devices = await trpc.device.listDevices.query();
          if (!isCurrent()) return;
          const stillEnrolled = devices.some(
            (d: { deviceId: string; registered?: boolean }) =>
              d.deviceId === wsIdentity.deviceId && d.registered,
          );
          if (!stillEnrolled) {
            info(`Workspace share ${wsId} was revoked while offline. Clearing local enrollment.`);
            removeWorkspaceEnrollment(wsId, enrollmentScope);
            continue;
          }
          if (!isCurrent()) return;
          await openWorkspaceConnection(wsId);
          info(`Restored workspace share connection: ${wsId}`);
        } catch (err) {
          // Non-fatal (e.g. transient network error): keep the record and retry on
          // the next startup rather than silently dropping the share.
          error(`Failed to restore workspace share ${wsId}: ${(err as Error).message}`);
        }
      }
    } finally {
      workspaceRestoreInFlight = false;
    }
  };

  client.on('auth_failed', (reason) => {
    error(
      `Gateway authentication stopped: ${reason}. Run '${CLI_PRIMARY_BIN} login' to reconnect.`,
    );
    cleanup();
    process.exit(1);
  });
  client.on('auth_expired', () => {
    if (isCurrent()) void client.reconnect();
  });

  // Another `lh connect` of this install (same persisted connection id) took
  // over. The client no longer reconnects — doing so is what made the two trade
  // the connection every second — so exit instead of sitting silently offline.
  client.on('replaced', () => {
    error(
      `Another '${CLI_PRIMARY_BIN} connect' on this machine took over this device's gateway connection. Only one can be connected at a time; stopping this one.`,
    );
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
    active = false;
    cleanupAllProcesses();
    // Kill every remote-terminal shell this daemon started, so a stopping
    // `lh connect` does not leave orphaned PTYs behind on the machine.
    terminals.dispose();
    // Close share connections but keep the persisted enrollments — the next
    // startup restores them (or clears them if revoked meanwhile).
    for (const wsId of workspaceDials.keys()) closeWorkspaceConnection(wsId);
    void metricsSampler?.stop();
    client.disconnect();
    removeStatus();
    if (isDaemonChild) {
      removePid();
    }
  };

  // A clean stop pushes the health samples taken since the last upload
  // (bounded) before the socket closes, so the device page doesn't show the
  // final minutes as "not running".
  const shutdown = async () => {
    await metricsSampler?.stop({ flushTimeoutMs: SHUTDOWN_METRICS_FLUSH_MS });
    cleanup();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Register this device in the server registry before opening the WS, so the
  // row exists by the time the gateway reports it online. `lh login` already
  // registers, but re-running here is cheap (idempotent upsert) and covers
  // `--token` sessions that never went through login. Best-effort: a failure
  // must not block the connection.
  if (identity) {
    try {
      // Reuse the already-resolved auth (respects `--token` mode) so we don't
      // re-discover creds and exit when none are found.
      if (workspaceId)
        await registerWorkspaceDevice(
          auth,
          identity,
          workspaceId,
          options.public ? 'public' : undefined,
        );
      else await registerDevice(auth, identity);
    } catch (err) {
      // Workspace-mode registration is AUTHORITATIVE, not best-effort: the
      // `devices` row is what carries the (default-private) visibility marker
      // that hides this machine from other members. Connecting without it —
      // whether the server refused the id (another member's PRIVATE
      // enrollment → CONFLICT) or the write simply failed transiently — would
      // join the workspace pool as an unregistered transient that everyone
      // can see, so abort before connecting.
      if (workspaceId) {
        error(`Workspace device registration failed: ${(err as Error).message}`);
        cleanup();
        process.exit(getWorkspaceFailureExitCode(err));
      }
      error(`Device registration failed (non-fatal): ${(err as Error).message}`);
    }
  }

  await reportDaemonStartupReady();

  await metricsSampler?.start();

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

function formatStatusGateway(status: { gatewaySource?: string; gatewayUrl: string }): string {
  return status.gatewaySource
    ? `${status.gatewayUrl} (${status.gatewaySource})`
    : status.gatewayUrl;
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
