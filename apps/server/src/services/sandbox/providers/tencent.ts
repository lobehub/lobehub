import { randomUUID } from 'node:crypto';

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
  scriptPrelude,
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
const BACKGROUND_DIR = '/tmp/lobe-background';

/**
 * Reads whatever a background command has produced since the previous check.
 *
 * The tool contract is a polling one — callers ask repeatedly for *new* output
 * while the process keeps running — so this must never block on completion.
 * Progress is tracked with an offset file next to the log.
 */
const backgroundStatusScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    base = Path('${BACKGROUND_DIR}') / str(args.get('commandId') or '')
    log, pid_file = base.with_suffix('.log'), base.with_suffix('.pid')
    exit_file, off_file = base.with_suffix('.exit'), base.with_suffix('.off')

    if not log.exists() and not pid_file.exists():
        emit({'success': False, 'error': 'unknown commandId'})
        return

    offset = int(off_file.read_text()) if off_file.exists() else 0
    chunk = b''
    if log.exists():
        with log.open('rb') as handle:
            handle.seek(offset)
            chunk = handle.read()
            off_file.write_text(str(handle.tell()))

    exit_code = None
    if exit_file.exists():
        text = exit_file.read_text().strip()
        exit_code = int(text) if text else None

    running = False
    if exit_code is None and pid_file.exists():
        try:
            os.kill(int(pid_file.read_text().strip()), 0)
            running = True
        except (OSError, ValueError):
            running = False

    output = chunk.decode(errors='replace')
    emit({
        'exitCode': exit_code,
        'newOutput': output,
        'output': output,
        'running': running,
        'stderr': '',
        'success': running or exit_code == 0,
    })
`;

const killBackgroundScript = `${scriptPrelude}
import signal

def main(encoded):
    args = load_args(encoded)
    pid_file = (Path('${BACKGROUND_DIR}') / str(args.get('commandId') or '')).with_suffix('.pid')
    if not pid_file.exists():
        emit({'success': False, 'error': 'unknown commandId'})
        return
    try:
        os.kill(int(pid_file.read_text().strip()), signal.SIGTERM)
    except (OSError, ValueError) as error:
        emit({'success': False, 'error': str(error)})
        return
    emit({'success': True})
`;

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
/**
 * In-flight acquisitions, so two concurrent tool calls for one session share a
 * container instead of racing and leaking the loser.
 */
const pending = new Map<string, Promise<AcquiredInstance>>();

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
        return this.runScript(sandbox, backgroundStatusScript, {
          commandId: this.commandId(params),
        });
      }

      case 'killCommand': {
        return this.runScript(sandbox, killBackgroundScript, {
          commandId: this.commandId(params),
        });
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
      const id = randomUUID();
      const base = `${BACKGROUND_DIR}/${id}`;
      // Detach through the shell so the caller is not tied to the process, and
      // persist stdout, the pid, and the exit code so later polls can report
      // progress without waiting for completion.
      const launch =
        `mkdir -p ${BACKGROUND_DIR}; ` +
        `( { ${command} ; } > ${base}.log 2>&1 ; echo $? > ${base}.exit ) & ` +
        `echo $! > ${base}.pid`;

      const result = await sandbox.commands.run(launch, {
        cwd: params.cwd as string | undefined,
        timeoutMs: this.timeoutMs(params),
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to start background command');
      }

      // The shared runtime reads `commandId` (or the legacy `shell_id`) and
      // passes it back to getCommandOutput/killCommand.
      return { commandId: id, shell_id: id };
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

  private commandId(params: Record<string, unknown>): string {
    const id = String(params.commandId ?? params.shell_id ?? '').trim();

    if (!id) throw new Error('commandId is required');

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
    const key = this.sessionKey();
    const inFlight = pending.get(key);

    if (inFlight) return inFlight;

    const promise = this.resolveInstance(key).finally(() => pending.delete(key));
    pending.set(key, promise);

    return promise;
  }

  private async resolveInstance(key: string): Promise<AcquiredInstance> {
    this.evictExpired();

    const cached = instances.get(key);

    if (cached) {
      // On-demand instances are not renewed, so they stay usable right up to
      // their real expiry — dropping them early would strand files and
      // background processes mid-session.
      if (sandboxEnv.TENCENT_SANDBOX_MODE === 'on-demand') return cached;

      if (cached.expiresAt - Date.now() > RENEW_THRESHOLD_MS) return cached;

      const renewed = await this.renew(cached);
      if (renewed) {
        instances.set(key, renewed);

        return renewed;
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
export const __clearSandboxInstances = () => {
  instances.clear();
  pending.clear();
};
