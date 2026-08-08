import { Sandbox } from '@e2b/code-interpreter';
import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';

import { sandboxEnv } from '@/envs/sandbox';

import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
  SandboxServiceOptions,
} from '../types';
import {
  buildScriptCommand,
  editFileScript,
  globFilesScript,
  grepContentScript,
  listFilesScript,
  moveFilesScript,
  prepareWriteFileScript,
  readFileScript,
  searchFilesScript,
} from './fileScripts';

const log = debug('lobe-server:sandbox:tencent');

const DEFAULT_API_BASE = 'https://pages-api.cloud.tencent.com/v1/sandbox';
const DEFAULT_REGION = 'ap-beijing';
const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const ENVD_PORT = '49983';
const ENVD_FALLBACK_VERSION = '0.2.4';
/** Renew a persistent instance once it is within this window of expiring. */
const RENEW_THRESHOLD_MS = 60_000;

interface AcquiredInstance {
  domain: string;
  envdVersion: string;
  expiresAt: number;
  instanceId: string;
  token: string;
  trafficToken?: string;
}

/**
 * Instances are keyed by session. A provider is constructed per request, but a
 * single tool call can fan out into several `callTool` invocations — file
 * bootstrapping runs a command before the requested tool — so the instance has
 * to outlive the provider for those to land in the same container.
 */
const instances = new Map<string, AcquiredInstance>();

export class TencentSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    // On-demand instances are never renewed, so state only survives until the
    // requested timeout elapses.
    persistentSession: sandboxEnv.TENCENT_SANDBOX_MODE !== 'on-demand',
    shell: true,
    // Skill archives are not downloaded into the sandbox yet; see `execScript`.
    skillScripts: false,
  } satisfies SandboxProviderCapabilities;

  readonly kind = 'tencent';

  private readonly options: SandboxServiceOptions;

  constructor(options: SandboxServiceOptions) {
    this.options = options;
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const configError = this.checkConfig();
    if (configError) return configError;

    try {
      const sandbox = await this.connect();
      const result = await this.dispatch(sandbox, toolName, params);

      return { result, sessionExpiredAndRecreated: false, success: true };
    } catch (error) {
      log('Tencent sandbox tool %s failed: %O', toolName, error);

      return {
        error: { message: (error as Error).message, name: (error as Error).name },
        result: null,
        sessionExpiredAndRecreated: false,
        success: false,
      };
    }
  }

  async exportFileToUploadUrl({
    path,
    uploadHeaders,
    uploadUrl,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    const configError = this.checkConfig();
    if (configError) return { error: configError.error, success: false };

    try {
      const sandbox = await this.connect();
      const content = await sandbox.files.read(path, { format: 'bytes' });
      const body = new Uint8Array(content);

      const response = await fetch(uploadUrl, { body, headers: uploadHeaders, method: 'PUT' });

      if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);

      return { size: body.byteLength, success: true };
    } catch (error) {
      log('Tencent sandbox export failed: %O', error);

      return {
        error: { message: (error as Error).message, name: (error as Error).name },
        success: false,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Tool dispatch
  // ---------------------------------------------------------------------------

  private async dispatch(
    sandbox: Sandbox,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'executeCode': {
        const execution = await sandbox.runCode(String(params.code ?? ''), {
          language: (params.language as string) ?? 'python',
        });

        return {
          error: execution.error ? execution.error.value : undefined,
          results: execution.results,
          stderr: execution.logs.stderr.join(''),
          stdout: execution.logs.stdout.join(''),
          success: !execution.error,
        };
      }

      case 'runCommand': {
        return this.runCommand(sandbox, params);
      }

      case 'getCommandOutput': {
        const handle = await sandbox.commands.connect(this.commandId(params));
        const result = await handle.wait();

        return {
          exitCode: result.exitCode,
          output: result.stdout,
          stderr: result.stderr,
          stdout: result.stdout,
          success: result.exitCode === 0,
        };
      }

      case 'killCommand': {
        return { success: await sandbox.commands.kill(this.commandId(params)) };
      }

      case 'writeFile':
      case 'writeLocalFile': {
        return this.writeFile(sandbox, params);
      }

      case 'listFiles':
      case 'listLocalFiles': {
        return this.runScript(sandbox, listFilesScript, params);
      }

      case 'readFile':
      case 'readLocalFile': {
        return this.runScript(sandbox, readFileScript, params);
      }

      case 'editFile':
      case 'editLocalFile': {
        return this.runScript(sandbox, editFileScript, params);
      }

      case 'searchFiles':
      case 'searchLocalFiles': {
        return this.runScript(sandbox, searchFilesScript, params);
      }

      case 'moveFiles':
      case 'moveLocalFiles': {
        return this.runScript(sandbox, moveFilesScript, params);
      }

      case 'globFiles':
      case 'globLocalFiles': {
        return this.runScript(sandbox, globFilesScript, params);
      }

      case 'grepContent': {
        return this.runScript(sandbox, grepContentScript, params);
      }

      case 'execScript': {
        throw new Error(
          'execScript is not supported by the Tencent sandbox provider yet; ' +
            'skill archives are not downloaded into the sandbox.',
        );
      }

      default: {
        throw new Error(`Unsupported sandbox tool: ${toolName}`);
      }
    }
  }

  private async runCommand(sandbox: Sandbox, params: Record<string, unknown>) {
    const command = String(params.command ?? '');
    if (!command.trim()) throw new Error('command is required');

    if (params.background === true) {
      const handle = await sandbox.commands.run(command, {
        background: true,
        cwd: params.cwd as string | undefined,
        timeoutMs: this.timeoutMs(params),
      });

      // The shared runtime reads `commandId` (or the legacy `shell_id`) and
      // passes it back to getCommandOutput/killCommand.
      return { commandId: String(handle.pid), shell_id: String(handle.pid) };
    }

    const result = await sandbox.commands.run(command, {
      cwd: params.cwd as string | undefined,
      timeoutMs: this.timeoutMs(params),
    });

    return {
      exitCode: result.exitCode,
      output: result.stdout,
      stderr: result.stderr,
      stdout: result.stdout,
      // Without this the runtime falls back to the outer envelope and reports a
      // failed command as successful.
      success: result.exitCode === 0,
    };
  }

  private async writeFile(sandbox: Sandbox, params: Record<string, unknown>) {
    const path = String(params.path ?? '');
    if (!path) throw new Error('path is required');

    // Reuse the shared script so `createDirectories` behaves identically across
    // providers, then stream the body through the sandbox filesystem API.
    await this.runScript(sandbox, prepareWriteFileScript, params);
    await sandbox.files.write(path, String(params.content ?? ''));

    return { path, success: true };
  }

  /**
   * Runs one of the shared Python helpers and returns its parsed JSON payload,
   * mirroring how the Onlyboxes provider executes the same scripts.
   */
  private async runScript(
    sandbox: Sandbox,
    script: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const result = await sandbox.commands.run(buildScriptCommand(script, params), {
      timeoutMs: this.timeoutMs(params),
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'Sandbox script failed');
    }

    const parsed = JSON.parse(result.stdout || '{}') as Record<string, unknown>;

    if (parsed.success === false) {
      throw new Error(String(parsed.error || 'Sandbox script failed'));
    }

    return parsed;
  }

  private commandId(params: Record<string, unknown>): number {
    const raw = params.commandId ?? params.shell_id ?? params.pid;
    const id = Number(raw);

    if (!Number.isFinite(id)) throw new Error('commandId is required');

    return id;
  }

  private timeoutMs(params: Record<string, unknown>): number {
    const value = params.timeout ?? params.timeout_ms;

    return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_COMMAND_TIMEOUT_MS;
  }

  // ---------------------------------------------------------------------------
  // Instance lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Returns a client for this session's instance, acquiring or renewing one as
   * needed.
   *
   * `persistent` renews before expiry so a topic keeps its container.
   * `on-demand` lets the instance lapse at `TENCENT_SANDBOX_TIMEOUT_SEC` and
   * acquires a fresh one afterwards, which bounds cost without breaking
   * multi-call flows such as file bootstrapping or background commands.
   */
  private async connect(): Promise<Sandbox> {
    return connect(await this.acquireForSession());
  }

  private async acquireForSession(): Promise<AcquiredInstance> {
    this.evictExpired();

    const key = this.sessionKey();
    const cached = instances.get(key);

    if (cached) {
      if (cached.expiresAt - Date.now() > RENEW_THRESHOLD_MS) return cached;

      if (sandboxEnv.TENCENT_SANDBOX_MODE !== 'on-demand') {
        const renewed = await this.renew(cached);
        if (renewed) {
          instances.set(key, renewed);
          return renewed;
        }
      }

      instances.delete(key);
      await this.release(cached.instanceId);
    }

    const instance = await this.acquire();
    instances.set(key, instance);

    return instance;
  }

  /** Keeps the module-level map from growing with abandoned sessions. */
  private evictExpired(): void {
    const now = Date.now();

    for (const [key, instance] of instances) {
      if (instance.expiresAt <= now) instances.delete(key);
    }
  }

  private async renew(instance: AcquiredInstance): Promise<AcquiredInstance | undefined> {
    try {
      await this.request('update', {
        InstanceId: instance.instanceId,
        Timeout: this.timeoutSec(),
      });

      return { ...instance, expiresAt: Date.now() + this.timeoutSec() * 1000 };
    } catch (error) {
      log('Failed to renew instance %s, will acquire a new one: %O', instance.instanceId, error);

      return undefined;
    }
  }

  private async acquire(): Promise<AcquiredInstance> {
    const data = await this.request('acquire', {
      ConversationId: this.sessionKey(),
      Region: sandboxEnv.TENCENT_SANDBOX_REGION || DEFAULT_REGION,
      Timeout: this.timeoutSec(),
    });

    const expiresAt = data.InstanceExpiresAt
      ? new Date(data.InstanceExpiresAt as string).getTime()
      : Date.now() + this.timeoutSec() * 1000;

    return {
      domain: data.SandboxDomain as string,
      envdVersion: (data.EnvdVersion as string) || ENVD_FALLBACK_VERSION,
      expiresAt,
      instanceId: data.InstanceId as string,
      token: data.Token as string,
      trafficToken: data.TrafficToken as string | undefined,
    };
  }

  private async release(instanceId: string): Promise<void> {
    try {
      await this.request('release', { InstanceId: instanceId });
    } catch (error) {
      // A leaked instance expires on its own; failing the tool call is worse.
      log('Failed to release instance %s: %O', instanceId, error);
    }
  }

  private async request(
    action: 'acquire' | 'release' | 'update',
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const base = sandboxEnv.TENCENT_SANDBOX_API_BASE || DEFAULT_API_BASE;

    const response = await fetch(`${base}/${action}`, {
      body: JSON.stringify({ ProjectId: sandboxEnv.TENCENT_SANDBOX_PROJECT_ID, ...payload }),
      headers: {
        'Authorization': `Bearer ${sandboxEnv.TENCENT_SANDBOX_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });

    if (!response.ok) throw new Error(`Sandbox ${action} failed with status ${response.status}`);

    const body = (await response.json()) as {
      Code?: number;
      Data?: Record<string, unknown>;
      message?: string;
    };

    if (body.Code !== 0 || !body.Data) {
      throw new Error(body.message || `Sandbox ${action} returned an error`);
    }

    return body.Data;
  }

  private sessionKey(): string {
    return `${this.options.userId}:${this.options.topicId}`;
  }

  private timeoutSec(): number {
    return sandboxEnv.TENCENT_SANDBOX_TIMEOUT_SEC || DEFAULT_TIMEOUT_SEC;
  }

  private checkConfig(): SandboxCallToolResult | undefined {
    if (sandboxEnv.TENCENT_SANDBOX_API_TOKEN && sandboxEnv.TENCENT_SANDBOX_PROJECT_ID) return;

    return {
      error: {
        message: 'TENCENT_SANDBOX_API_TOKEN and TENCENT_SANDBOX_PROJECT_ID are required',
        name: 'SandboxConfigError',
      },
      result: null,
      sessionExpiredAndRecreated: false,
      success: false,
    };
  }
}

/**
 * Builds the client directly instead of using `Sandbox.connect()`, which would
 * look the instance up through the e2b.dev control plane and require an E2B
 * API key. Tencent issues the instance itself, so only the returned connection
 * details are needed.
 */
const connect = (instance: AcquiredInstance): Sandbox =>
  new Sandbox({
    domain: instance.domain,
    envdAccessToken: instance.token,
    envdVersion: instance.envdVersion,
    headers: {
      'E2b-Sandbox-Id': instance.instanceId,
      'E2b-Sandbox-Port': ENVD_PORT,
      'X-Access-Token': instance.token,
    },
    sandboxDomain: instance.domain,
    sandboxId: instance.instanceId,
    trafficAccessToken: instance.trafficToken,
  });

/** Exposed for tests; instance reuse is otherwise process-wide. */
export const __clearSandboxInstances = () => instances.clear();
