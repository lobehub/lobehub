import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
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
import {
  type AuvRunCommandParams,
  type AuvRunCommandResult,
  normalizeAuvArgv,
  runAuvCommand,
} from '@lobechat/device-control/computer-use';

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

export type { AuvRunCommandParams, AuvRunCommandResult };

export interface AuvCliExecutionOptions {
  argv: string[];
  binaryPath: string;
  /** Launcher token of the app-owned daemon; written to the CLI's stdin, never argv or env. */
  credential: string;
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
  hostname: () => string;
  loadSdk: () => Promise<AuvSdkRuntime>;
  resolveBinaryPath: () => Promise<string>;
  runCli: (options: AuvCliExecutionOptions) => Promise<{ stderr: string; stdout: string }>;
}

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
  credential,
  endpoint,
  storeRoot,
}: AuvCliExecutionOptions): Promise<{ stderr: string; stdout: string }> => {
  // `--credential-stdin` is a root flag, so it must precede the subcommand.
  const pending = execFileAsync(
    binaryPath,
    ['--credential-stdin', ...argv, '--store-root', storeRoot],
    {
      encoding: 'utf8',
      env: { ...process.env, AUV_ENDPOINT: endpoint },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      windowsHide: true,
    },
  );
  pending.child.stdin?.end(`${credential}\n`);
  const { stderr, stdout } = await pending;

  return { stderr, stdout };
};

const defaultDependencies: AuvRuntimeDependencies = {
  hostname: os.hostname,
  loadSdk: () => import('@auv-js/sdk/node'),
  resolveBinaryPath: resolveAuvBinaryPath,
  runCli: runAuvCli,
};

const normalizeHostname = (hostname: string) => hostname.replace(/\.(?:lan|local)$/i, '');

const serializeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
    this.client = null;
    this.connection = null;
    this.daemon = null;
    this.binaryPath = null;

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

  /**
   * Triggering workflow: AuvCtr / GatewayConnectionCtr `runCommand` -> runCommand
   * -> private app-owned CLI invocation; preserve output on nonzero exits.
   */
  async runCommand(params: AuvRunCommandParams): Promise<AuvRunCommandResult> {
    const argv = normalizeAuvArgv(params);
    await this.getClient();
    const binaryPath = this.binaryPath;
    const credential = this.daemon?.connectionOptions.credential;
    // The CLI needs the listener URI; `connectionOptions.endpoint` drops the `unix://` scheme.
    const endpoint = this.daemon?.endpoints[0];
    if (!binaryPath || !credential || !endpoint) throw new Error('AUV is not connected');

    return runAuvCommand(params, argv, (cliArgv) =>
      this.dependencies.runCli({
        argv: cliArgv,
        binaryPath,
        credential,
        endpoint,
        storeRoot: path.join(this.app.appStoragePath, 'auv', 'runs'),
      }),
    );
  }

  destroy() {
    void this.disconnect().catch((error) => logger.warn('Failed to stop AUV cleanly:', error));
  }

  private async open(): Promise<AuvConnectionSnapshot> {
    let connection: AuvConnection | null = null;
    let daemon: AuvDaemon | null = null;

    try {
      const sdk = await this.dependencies.loadSdk();
      const binaryPath =
        process.env.AUV_BINARY_PATH || (await this.dependencies.resolveBinaryPath());
      const auvRoot = path.join(this.app.appStoragePath, 'auv');
      // Without `local.listen` the SDK binds an owner-only Unix socket or named
      // pipe, and the default `launcher-token` auth admits only callers holding
      // this launch's token: this process and the CLI children it hands it to.
      daemon = await sdk.startAuv({
        binaryPath,
        noRegister: true,
        storeRoot: path.join(auvRoot, 'store'),
      });

      const { credential, local, transport } = daemon.connectionOptions;
      if (!local || (transport !== 'unix' && transport !== 'npipe')) {
        throw new Error(`AUV refused non-private transport: ${transport}`);
      }
      if (!credential) throw new Error('AUV daemon did not issue a launcher token');

      connection = await daemon.connect();
      const client = sdk.createAuv(connection);
      await client.health.check();

      this.connection = connection;
      this.daemon = daemon;
      this.binaryPath = binaryPath;
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
      this.connection = null;
      this.daemon = null;
      this.binaryPath = null;
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
