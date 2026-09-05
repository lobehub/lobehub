import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, mkdtemp, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  AuvClient,
  AuvConnection,
  AuvDaemon,
  createAuv,
  Device,
  RunnerClass,
  startAuv,
} from '@auv-js/sdk/node';

import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:AuvSrv');

export interface AuvSdkRuntime {
  createAuv: typeof createAuv;
  startAuv: typeof startAuv;
}

export type AuvConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface AuvDeviceInfo {
  id: string;
  labels: Record<string, string>;
  local: boolean;
  name: string;
  platform: Device['platform'];
}

export interface AuvRunnerClassInfo {
  available: boolean;
  deviceId?: string;
  displayName: string;
  id: string;
  supportedLifecycles: RunnerClass['supportedLifecycles'];
}

export interface AuvRunCommandParams {
  argv: string[];
}

export interface AuvRunCommandResult {
  argv: string[];
  output: unknown;
  stderr?: string;
}

export interface AuvCliExecutionOptions {
  argv: string[];
  binaryPath: string;
  endpoint: string;
  storeRoot: string;
}

export interface AuvConnectionSnapshot {
  devices: AuvDeviceInfo[];
  error?: string;
  runnerClasses: AuvRunnerClassInfo[];
  status: AuvConnectionStatus;
  transport?: 'npipe' | 'unix';
}

export interface AuvRuntimeDependencies {
  createIpcListener: () => Promise<PrivateIpcListener>;
  hostname: () => string;
  loadSdk: () => Promise<AuvSdkRuntime>;
  resolveBinaryPath: () => Promise<string>;
  runCli: (options: AuvCliExecutionOptions) => Promise<{ stderr: string; stdout: string }>;
}

export interface PrivateIpcListener {
  cleanup?: () => Promise<void>;
  listener: string;
}

const createPrivateIpcListener = async (): Promise<PrivateIpcListener> => {
  if (process.platform === 'win32') {
    return { listener: `npipe://./pipe/lobehub-auv-${randomUUID()}` };
  }

  // Darwin's sockaddr_un.sun_path is only 104 bytes. A short mkdtemp path also
  // gives each app-owned child an unguessable, owner-only directory.
  const ipcDirectory = await mkdtemp('/tmp/lobehub-auv-');
  await chmod(ipcDirectory, 0o700);
  return {
    cleanup: () => rmdir(ipcDirectory),
    listener: `unix://${path.join(ipcDirectory, 'auv.sock')}`,
  };
};

const resolveAuvBinaryPath = async (): Promise<string> => {
  const executable = process.platform === 'win32' ? 'auv.exe' : 'auv';
  const packagedBinary = process.resourcesPath
    ? path.join(process.resourcesPath, 'bin', executable)
    : undefined;

  if (packagedBinary) {
    try {
      await access(packagedBinary);
      return packagedBinary;
    } catch {
      // Development resolves the platform-matched executable from @auv-js/cli.
    }
  }

  const { binaryPath } = await import('@auv-js/cli/binary');
  return binaryPath();
};

const execFileAsync = promisify(execFile);

const runAuvCli = async ({
  argv,
  binaryPath,
  endpoint,
  storeRoot,
}: AuvCliExecutionOptions): Promise<{ stderr: string; stdout: string }> => {
  const { stderr, stdout } = await execFileAsync(binaryPath, [...argv, '--store-root', storeRoot], {
    encoding: 'utf8',
    env: { ...process.env, AUV_ENDPOINT: endpoint },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  });

  return { stderr, stdout };
};

const defaultDependencies: AuvRuntimeDependencies = {
  createIpcListener: createPrivateIpcListener,
  hostname: os.hostname,
  loadSdk: () => import('@auv-js/sdk/node'),
  resolveBinaryPath: resolveAuvBinaryPath,
  runCli: runAuvCli,
};

const normalizeHostname = (hostname: string) => hostname.replace(/\.(?:lan|local)$/i, '');

const serializeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

const MAX_CLI_ARGUMENTS = 128;
const MAX_CLI_ARGUMENT_LENGTH = 16_384;
const AUV_COMMAND_ID = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;

const normalizeCliArgv = (params: AuvRunCommandParams): string[] => {
  if (!Array.isArray(params.argv)) throw new Error('AUV argv must be an array');
  if (params.argv.length < 2) {
    throw new Error('AUV argv must include "invoke" and a command or --help');
  }
  if (params.argv.length > MAX_CLI_ARGUMENTS) {
    throw new Error(`AUV argv cannot contain more than ${MAX_CLI_ARGUMENTS} arguments`);
  }

  const argv = params.argv.map((argument) => {
    if (typeof argument !== 'string') throw new Error('Every AUV argument must be a string');
    if (argument.includes('\0')) throw new Error('AUV arguments cannot contain NUL bytes');
    if (argument.length > MAX_CLI_ARGUMENT_LENGTH) {
      throw new Error(`AUV arguments cannot exceed ${MAX_CLI_ARGUMENT_LENGTH} characters`);
    }
    return argument;
  });

  if (argv[0] !== 'invoke') {
    throw new Error('Only "auv invoke" commands are allowed');
  }
  if (
    argv.some((argument) => argument === '--store-root' || argument.startsWith('--store-root='))
  ) {
    throw new Error('AUV --store-root is managed by LobeHub');
  }

  const command = argv[1]!;
  if (
    command !== '--help' &&
    command !== '-h' &&
    command !== 'help' &&
    !AUV_COMMAND_ID.test(command)
  ) {
    throw new Error(`Invalid AUV invoke command: ${command}`);
  }

  const isHelp = argv.includes('--help') || argv.includes('-h') || command === 'help';
  if (!isHelp && !argv.includes('--json')) argv.push('--json');
  return argv;
};

const parseCliOutput = (stdout: string): unknown => {
  const output = stdout.trim();
  if (!output) return null;

  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
};

/**
 * Owns the AUV SDK connection and, when needed, the embedded daemon lifecycle.
 * Renderer callers only receive serializable snapshots; raw SDK and child-process
 * handles remain in the Electron main process.
 */
export default class AuvService extends ServiceModule {
  private client: AuvClient | null = null;
  private connectInFlight: Promise<AuvConnectionSnapshot> | null = null;
  private connection: AuvConnection | null = null;
  private daemon: AuvDaemon | null = null;
  private binaryPath: string | null = null;
  private ipcCleanup: (() => Promise<void>) | null = null;
  private ipcEndpoint: string | null = null;
  private snapshot: AuvConnectionSnapshot = {
    devices: [],
    runnerClasses: [],
    status: 'disconnected',
  };

  constructor(
    app: App,
    private readonly dependencies: AuvRuntimeDependencies = defaultDependencies,
  ) {
    super(app);
  }

  /** Connect once and return a fresh inventory of the target AUV daemon. */
  async connect(): Promise<AuvConnectionSnapshot> {
    if (this.connectInFlight) return this.connectInFlight;

    if (this.connection && this.client) {
      return this.refreshSnapshot();
    }

    this.snapshot = { devices: [], runnerClasses: [], status: 'connecting' };
    const task = this.open().finally(() => {
      this.connectInFlight = null;
    });
    this.connectInFlight = task;
    return task;
  }

  /** Close the SDK transport and stop an app-owned daemon, if one was started. */
  async disconnect(): Promise<AuvConnectionSnapshot> {
    if (this.connectInFlight) {
      try {
        await this.connectInFlight;
      } catch {
        // The failed connection path already released any partially-owned handles.
      }
    }

    const connection = this.connection;
    const daemon = this.daemon;
    const ipcCleanup = this.ipcCleanup;
    this.client = null;
    this.connection = null;
    this.daemon = null;
    this.binaryPath = null;
    this.ipcCleanup = null;
    this.ipcEndpoint = null;

    const errors: unknown[] = [];
    try {
      await connection?.close();
    } catch (error) {
      errors.push(error);
    }

    try {
      await daemon?.stop();
    } catch (error) {
      errors.push(error);
    }

    try {
      await ipcCleanup?.();
    } catch (error) {
      errors.push(error);
    }

    this.snapshot = { devices: [], runnerClasses: [], status: 'disconnected' };
    if (errors.length > 0) throw errors[0];
    return this.getSnapshot();
  }

  getSnapshot(): AuvConnectionSnapshot {
    return {
      ...this.snapshot,
      devices: this.snapshot.devices.map((device) => ({ ...device, labels: { ...device.labels } })),
      runnerClasses: this.snapshot.runnerClasses.map((runnerClass) => ({ ...runnerClass })),
    };
  }

  /** Let other main-process modules use AUV without learning its lifecycle rules. */
  async getClient(): Promise<AuvClient> {
    if (!this.client) await this.connect();
    return this.client!;
  }

  /** Execute one allowlisted AUV CLI invocation against the private app-owned daemon. */
  async runCommand(params: AuvRunCommandParams): Promise<AuvRunCommandResult> {
    const argv = normalizeCliArgv(params);
    await this.getClient();
    if (!this.binaryPath || !this.ipcEndpoint) throw new Error('AUV is not connected');

    const { stderr, stdout } = await this.dependencies.runCli({
      argv,
      binaryPath: this.binaryPath,
      endpoint: this.ipcEndpoint,
      storeRoot: path.join(this.app.appStoragePath, 'auv', 'runs'),
    });
    const stderrOutput = stderr.trim();

    return {
      argv: [...params.argv],
      output: parseCliOutput(stdout),
      ...(stderrOutput && { stderr: stderrOutput }),
    };
  }

  destroy() {
    void this.disconnect().catch((error) => logger.warn('Failed to stop AUV cleanly:', error));
  }

  private async open(): Promise<AuvConnectionSnapshot> {
    let connection: AuvConnection | null = null;
    let daemon: AuvDaemon | null = null;
    let privateIpc: PrivateIpcListener | null = null;

    try {
      const sdk = await this.dependencies.loadSdk();
      const binaryPath =
        process.env.AUV_BINARY_PATH || (await this.dependencies.resolveBinaryPath());
      const auvRoot = path.join(this.app.appStoragePath, 'auv');
      privateIpc = await this.dependencies.createIpcListener();
      daemon = await sdk.startAuv({
        binaryPath,
        listeners: [privateIpc.listener],
        noDiscovery: true,
        storeRoot: path.join(auvRoot, 'store'),
      });

      const { local, transport } = daemon.connectionOptions;
      if (!local || (transport !== 'unix' && transport !== 'npipe')) {
        throw new Error(`AUV refused non-private transport: ${transport}`);
      }

      connection = await daemon.connect();
      const client = sdk.createAuv(connection);
      await client.health.check();

      this.connection = connection;
      this.daemon = daemon;
      this.binaryPath = binaryPath;
      this.ipcCleanup = privateIpc.cleanup ?? null;
      this.ipcEndpoint = privateIpc.listener;
      this.client = client;
      this.snapshot = { devices: [], runnerClasses: [], status: 'connected', transport };

      const snapshot = await this.refreshSnapshot();
      logger.info(
        `Connected to app-owned AUV via ${transport}; devices: ${snapshot.devices.map((device) => device.name).join(', ')}`,
      );
      return snapshot;
    } catch (error) {
      await connection?.close().catch(() => undefined);
      await daemon?.stop().catch(() => undefined);
      await privateIpc?.cleanup?.().catch(() => undefined);
      this.connection = null;
      this.daemon = null;
      this.binaryPath = null;
      this.ipcCleanup = null;
      this.ipcEndpoint = null;
      this.client = null;
      this.snapshot = {
        devices: [],
        error: serializeError(error),
        runnerClasses: [],
        status: 'error',
      };
      throw error;
    }
  }

  private async refreshSnapshot(): Promise<AuvConnectionSnapshot> {
    if (!this.client) throw new Error('AUV is not connected');

    const devices = await this.client.devices.list();
    const localName = normalizeHostname(this.dependencies.hostname());
    const deviceInfo = devices.map((device) => this.toDeviceInfo(device, localName));
    // Local IPC connections are already scoped to the app-owned daemon. The SDK
    // rejects an explicit device selector on this transport.
    const runnerClasses = await this.client.runners.listClasses();

    this.snapshot = {
      devices: deviceInfo,
      runnerClasses: runnerClasses.map(this.toRunnerClassInfo),
      status: 'connected',
      transport: this.snapshot.transport,
    };
    return this.getSnapshot();
  }

  private toDeviceInfo(device: Device, localName: string): AuvDeviceInfo {
    return {
      id: device.id,
      labels: { ...device.labels },
      local: device.local,
      name: device.name || (device.local ? localName : device.id),
      platform: device.platform,
    };
  }

  private toRunnerClassInfo(runnerClass: RunnerClass): AuvRunnerClassInfo {
    return {
      available: runnerClass.available,
      deviceId: runnerClass.deviceId,
      displayName: runnerClass.displayName,
      id: runnerClass.id,
      supportedLifecycles: runnerClass.supportedLifecycles,
    };
  }
}
