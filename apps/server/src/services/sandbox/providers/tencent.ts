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

const log = debug('lobe-server:sandbox:tencent');

const DEFAULT_API_BASE = 'https://pages-api.cloud.tencent.com/v1/sandbox';
const DEFAULT_REGION = 'ap-beijing';
const DEFAULT_TIMEOUT_SEC = 300;
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
 * Instances are keyed by session so that `persistent` mode reuses the same
 * container across tool calls. Kept at module scope because a provider
 * instance is constructed per request.
 */
const persistentInstances = new Map<string, AcquiredInstance>();

export class TencentSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    persistentSession: sandboxEnv.TENCENT_SANDBOX_MODE !== 'on-demand',
    shell: true,
    skillScripts: true,
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
      return await this.withSandbox(async (sandbox) => {
        const result = await this.dispatch(sandbox, toolName, params);

        return { result, sessionExpiredAndRecreated: false, success: true };
      });
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
      return await this.withSandbox(async (sandbox) => {
        const content = await sandbox.files.read(path, { format: 'bytes' });
        const body = new Uint8Array(content);

        const response = await fetch(uploadUrl, {
          body,
          headers: uploadHeaders,
          method: 'PUT',
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        return { size: body.byteLength, success: true };
      });
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
    const str = (key: string): string => {
      const value = params[key];
      if (typeof value !== 'string') throw new Error(`Missing required parameter: ${key}`);
      return value;
    };

    switch (toolName) {
      case 'executeCode': {
        const execution = await sandbox.runCode(str('code'), {
          language: (params.language as string) ?? 'python',
        });

        return {
          error: execution.error ? execution.error.value : undefined,
          results: execution.results,
          stderr: execution.logs.stderr.join(''),
          stdout: execution.logs.stdout.join(''),
        };
      }

      case 'execScript':
      case 'runCommand': {
        const background = params.background === true;
        const handle = await sandbox.commands.run(str('command'), {
          background,
          cwd: params.cwd as string | undefined,
        });

        if (background) return { pid: handle.pid, running: true };

        return {
          exitCode: handle.exitCode,
          stderr: handle.stderr,
          stdout: handle.stdout,
        };
      }

      case 'getCommandOutput': {
        const handle = await sandbox.commands.connect(Number(params.pid));
        const result = await handle.wait();

        return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout };
      }

      case 'killCommand': {
        return { killed: await sandbox.commands.kill(Number(params.pid)) };
      }

      case 'listFiles':
      case 'listLocalFiles': {
        const entries = await sandbox.files.list(str('path'));

        return { files: entries.map((entry) => ({ name: entry.name, type: entry.type })) };
      }

      case 'readFile':
      case 'readLocalFile': {
        return { content: await sandbox.files.read(str('path')) };
      }

      case 'writeFile':
      case 'writeLocalFile': {
        const path = str('path');
        await sandbox.files.write(path, str('content'));

        return { path, written: true };
      }

      case 'editFile':
      case 'editLocalFile': {
        const path = str('path');
        const original = await sandbox.files.read(path);
        const oldString = str('oldString');

        if (!original.includes(oldString)) {
          throw new Error(`The string to replace was not found in ${path}`);
        }

        const updated = original.replace(oldString, str('newString'));
        await sandbox.files.write(path, updated);

        return { edited: true, path };
      }

      case 'moveFiles':
      case 'moveLocalFiles': {
        const source = str('source');
        const destination = str('destination');
        await this.runShell(sandbox, `mv -- ${quote(source)} ${quote(destination)}`);

        return { destination, moved: true, source };
      }

      case 'globLocalFiles':
      case 'searchFiles':
      case 'searchLocalFiles': {
        const path = (params.path as string) ?? '.';
        const pattern = str('pattern');
        const stdout = await this.runShell(
          sandbox,
          `find ${quote(path)} -name ${quote(pattern)} -type f`,
        );

        return { files: splitLines(stdout) };
      }

      case 'grepContent': {
        const path = (params.path as string) ?? '.';
        const stdout = await this.runShell(
          sandbox,
          `grep -rn -- ${quote(str('pattern'))} ${quote(path)} || true`,
        );

        return { matches: splitLines(stdout) };
      }

      default: {
        throw new Error(`Unsupported sandbox tool: ${toolName}`);
      }
    }
  }

  private async runShell(sandbox: Sandbox, command: string): Promise<string> {
    const result = await sandbox.commands.run(command);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `Command exited with code ${result.exitCode}`);
    }

    return result.stdout;
  }

  // ---------------------------------------------------------------------------
  // Instance lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Runs `fn` against a connected sandbox.
   *
   * In `persistent` mode the instance is cached per session and renewed before
   * it expires. In `on-demand` mode a fresh instance is acquired for the call
   * and released afterwards, which trades cold-start latency for cost.
   */
  private async withSandbox<T>(fn: (sandbox: Sandbox) => Promise<T>): Promise<T> {
    const onDemand = sandboxEnv.TENCENT_SANDBOX_MODE === 'on-demand';
    const instance = onDemand ? await this.acquire() : await this.acquirePersistent();

    try {
      return await fn(connect(instance));
    } finally {
      if (onDemand) await this.release(instance.instanceId);
    }
  }

  private async acquirePersistent(): Promise<AcquiredInstance> {
    const key = this.sessionKey();
    const cached = persistentInstances.get(key);

    if (cached && cached.expiresAt - Date.now() > RENEW_THRESHOLD_MS) return cached;

    if (cached) {
      // Still valid but close to expiry — extend rather than pay a cold start.
      const renewed = await this.renew(cached);
      if (renewed) {
        persistentInstances.set(key, renewed);
        return renewed;
      }
    }

    const instance = await this.acquire();
    persistentInstances.set(key, instance);

    return instance;
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

    if (!response.ok) {
      throw new Error(`Sandbox ${action} failed with status ${response.status}`);
    }

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

const quote = (value: string): string => `'${value.replaceAll("'", String.raw`'\''`)}'`;

const splitLines = (value: string): string[] =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
