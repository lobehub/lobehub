import { randomBytes } from 'node:crypto';
import posixPath from 'node:path/posix';

import type * as BoxdSdkModule from '@boxd-sh/sdk';
import type { Boxd as BoxdClient } from '@boxd-sh/sdk';
import {
  SANDBOX_UPLOADED_FILES_DIR,
  type SandboxCallToolResult,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { isRecord } from '@lobechat/utils';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { sandboxEnv } from '@/envs/sandbox';

import type {
  SandboxProvider,
  SandboxProviderCapabilities,
  SandboxProviderFileExportRequest,
  SandboxProviderFileExportResult,
  SandboxServiceOptions,
} from '../types';
import {
  boxdToolScript,
  cappedRunner,
  OUTPUT_LIMIT_BYTES,
  READ_FILE_LIMIT_CHARS,
} from './boxdScript';

type BoxdSdk = typeof BoxdSdkModule;
type Handler = (
  computer: string,
  boxd: BoxdClient,
  params: Record<string, unknown>,
) => Promise<SandboxCallToolResult>;

interface ExecOutcome {
  exitCode: number;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
}

interface ShellOutcome extends ExecOutcome {
  stderrBytes?: number;
  stdoutBytes?: number;
  truncated: boolean;
}

const log = debug('lobe-server:sandbox:boxd');

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_LEASE_TTL_SEC = 900;
const IDLE_SUSPEND_SEC = 300;
const CHECK_INTERVAL_MS = 60_000;
const SETUP_TIMEOUT_MS = 30_000;
/** The upload may take 300 s inside the computer (boxdScript), plus time to start and report. */
const EXPORT_TIMEOUT_MS = 330_000;
const TIMEOUT_EXIT_CODE = 124;
const CACHE_LIMIT = 1024;
const HOME_DIR = '/home/boxd';
const WORKSPACE_DIR = `${HOME_DIR}/workspace`;
const COMMANDS_DIR = '/tmp/lobe-commands';
const CODE_DIR = '/tmp/lobe-code';
const SKILL_ARCHIVE_CACHE_DIR = '/tmp/lobe-skills';
const COMMAND_ID_PATTERN = /^cmd_[\da-f]{16}$/;
const ENV_NAME_PATTERN = /^[A-Z_a-z]\w*$/;
const MISSING_CONFIG_MESSAGE =
  'SANDBOX_PROVIDER=boxd needs BOXD_API_KEY. Create a key with `boxd auth keys create` and set it on the LobeHub server.';

const CODE_RUNNERS: Record<string, { extension: string; run: (file: string) => string }> = {
  javascript: { extension: 'js', run: (file) => `node ${shellQuote(file)}` },
  python: { extension: 'py', run: (file) => `python3 ${shellQuote(file)}` },
  typescript: {
    extension: 'ts',
    run: (file) =>
      `if command -v bun >/dev/null 2>&1; then bun ${shellQuote(file)}; else npx --yes tsx ${shellQuote(file)}; fi`,
  },
};

/**
 * Per-request providers share one client and one map of computers per topic,
 * so a topic keeps its computer across tool calls in this process. Another
 * process finds the same computer by its name, which the topic determines.
 * The maps keep the most recent CACHE_LIMIT topics.
 */
let sdkPromise: Promise<BoxdSdk> | undefined;
let clientPromise: Promise<BoxdClient> | undefined;
const computerIds = new Map<string, string>();
const pendingComputers = new Map<string, Promise<string>>();
const preparedComputers = new Map<string, true>();
const checkedAt = new Map<string, number>();
const reportedModes = new Set<string>();

const loadSdk = () => {
  sdkPromise ??= import('@boxd-sh/sdk').catch((error) => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
};

const getClient = () => {
  clientPromise ??= loadSdk()
    .then(
      ({ Boxd }) =>
        new Boxd({
          apiKey: sandboxEnv.BOXD_API_KEY,
          baseURL: sandboxEnv.BOXD_BASE_URL,
          region: sandboxEnv.BOXD_REGION,
        }),
    )
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  return clientPromise;
};

/** Sets a cache entry as the newest, dropping the oldest past CACHE_LIMIT. */
const remember = <K, V>(cache: Map<K, V>, key: K, value: V) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as K);
};

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** exec on a deleted computer exits -1 with no output instead of failing; this is that case. */
class ComputerGoneError extends Error {
  override name = 'ComputerGoneError';
}

class MachineLimitError extends Error {
  override name = 'BoxdMachineLimitError';
}

export class BoxdSandboxProvider implements SandboxProvider {
  readonly capabilities = {
    backgroundCommands: true,
    exportFile: true,
    files: true,
    languages: ['python', 'javascript', 'typescript'],
    persistentSession: true,
    shell: true,
    skillScripts: true,
  } as const satisfies SandboxProviderCapabilities;

  readonly kind = 'boxd';

  private readonly options: SandboxServiceOptions;
  private readonly handlers: Record<string, Handler>;

  constructor(options: SandboxServiceOptions) {
    this.options = options;

    const { sandboxMode } = options;
    if (sandboxMode && sandboxMode !== 'ephemeral' && !reportedModes.has(sandboxMode)) {
      reportedModes.add(sandboxMode);
      log('sandboxMode %s is not supported by the boxd provider; running ephemeral', sandboxMode);
    }

    const listFiles: Handler = (id, boxd, params) => this.listFiles(id, boxd, params);
    const readFile: Handler = (id, boxd, params) => this.readFile(id, boxd, params);
    const writeFile: Handler = (id, boxd, params) => this.writeFile(id, boxd, params);
    const editFile: Handler = (id, boxd, params) => this.editFile(id, boxd, params);
    const moveFiles: Handler = (id, boxd, params) => this.moveFiles(id, boxd, params);
    const searchFiles: Handler = (id, boxd, params) => this.runScript(id, boxd, 'search', params);
    const globFiles: Handler = (id, boxd, params) => this.runScript(id, boxd, 'glob', params);

    this.handlers = {
      editFile,
      editLocalFile: editFile,
      executeCode: (id, boxd, params) => this.executeCode(id, boxd, params),
      execScript: (id, boxd, params) => this.execScript(id, boxd, params),
      getCommandOutput: (id, boxd, params) => this.getCommandOutput(id, boxd, params),
      globFiles,
      globLocalFiles: globFiles,
      grepContent: (id, boxd, params) => this.runScript(id, boxd, 'grep', params),
      killCommand: (id, boxd, params) => this.killCommand(id, boxd, params),
      listFiles,
      listLocalFiles: listFiles,
      moveFiles,
      moveLocalFiles: moveFiles,
      readFile,
      readLocalFile: readFile,
      renameLocalFile: (id, boxd, params) => this.renameFile(id, boxd, params),
      runCommand: (id, boxd, params) => this.runCommand(id, boxd, params),
      searchFiles,
      searchLocalFiles: searchFiles,
      writeFile,
      writeLocalFile: writeFile,
    };
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    if (!sandboxEnv.BOXD_API_KEY) return errorResult(MISSING_CONFIG_MESSAGE);

    const handler = this.handlers[toolName];
    if (!handler) return errorResult(`Unsupported boxd sandbox tool: ${toolName}`);

    const invalid = invalidParams(toolName, params);
    if (invalid) return errorResult(invalid);

    try {
      const { recreated, value } = await this.onComputer((id, boxd) => handler(id, boxd, params));
      return recreated ? { ...value, sessionExpiredAndRecreated: true } : value;
    } catch (error) {
      log('boxd tool %s failed: %O', toolName, error);
      return errorResult((error as Error).message, (error as Error).name);
    }
  }

  async exportFileToUploadUrl({
    path,
    uploadHeaders,
    uploadUrl,
  }: SandboxProviderFileExportRequest): Promise<SandboxProviderFileExportResult> {
    if (!sandboxEnv.BOXD_API_KEY)
      return { error: { message: MISSING_CONFIG_MESSAGE }, success: false };

    try {
      const { value } = await this.onComputer((id, boxd) =>
        this.runScript(
          id,
          boxd,
          'export',
          { headers: uploadHeaders ?? {}, path: this.resolvePath(path), url: uploadUrl },
          EXPORT_TIMEOUT_MS,
        ),
      );

      if (!value.success)
        return { error: { message: value.error?.message ?? 'Export failed' }, success: false };

      return {
        mimeType: String(value.result?.mimeType || ''),
        result: value.result ?? undefined,
        size: typeof value.result?.size === 'number' ? value.result.size : undefined,
        success: true,
      };
    } catch (error) {
      log('boxd export failed: %O', error);
      return { error: { message: (error as Error).message }, success: false };
    }
  }

  // ==================== Computers ====================

  /**
   * One computer per topic. `drive` and `persistent` runs get the topic's
   * computer too: LobeHub keys a drive by workspace and member and serves it
   * through Market's storage, which a boxd computer is not part of.
   */
  private get computerKey() {
    return `topic:${this.options.userId}:${this.options.topicId}`;
  }

  /** Runs an operation on the topic's computer, starting or replacing it when needed. */
  private async onComputer<T>(
    operation: (computer: string, boxd: BoxdClient) => Promise<T>,
  ): Promise<{ recreated: boolean; value: T }> {
    const [sdk, boxd] = await Promise.all([loadSdk(), getClient()]);
    const { id, recreated } = await this.liveComputer(boxd);

    try {
      return { recreated, value: await operation(id, boxd) };
    } catch (error) {
      if (error instanceof sdk.ConflictError && /\bstopped\b/i.test(error.message)) {
        log('computer %s is stopped, starting it', id);
        await this.startComputer(id, boxd);
        return { recreated, value: await operation(id, boxd) };
      }

      // Deleted since it was last checked: the call never ran, so it runs again.
      if (error instanceof sdk.NotFoundError || error instanceof ComputerGoneError) {
        log('computer %s is gone, creating a new one', id);
        this.forgetComputer(id);
        const replacement = await this.computer(boxd);
        return { recreated: true, value: await operation(replacement, boxd) };
      }

      throw error;
    }
  }

  /**
   * The topic's computer, checked against boxd at most once a minute: one
   * whose lease ran out, that someone deleted or that failed is replaced, a
   * stopped one is started, and the deletion of a live one is pushed back.
   * The check is needed because boxd does not fail every call on a deleted
   * computer: a file listing comes back empty and exec exits -1.
   */
  private async liveComputer(boxd: BoxdClient) {
    const id = await this.computer(boxd);
    if (Date.now() - (checkedAt.get(id) ?? 0) < CHECK_INTERVAL_MS) return { id, recreated: false };
    remember(checkedAt, id, Date.now());

    const status = await this.computerStatus(id, boxd);
    if (status === 'gone' || status === 'failed') {
      log('computer %s is %s, creating a new one', id, status);
      if (status === 'failed') await this.removeComputer(id, boxd);
      this.forgetComputer(id);
      return { id: await this.computer(boxd), recreated: true };
    }

    if (status === 'stopped') await this.startComputer(id, boxd);
    await this.extendLease(id, boxd);

    return { id, recreated: false };
  }

  private async computer(boxd: BoxdClient) {
    const key = this.computerKey;
    let id = computerIds.get(key);

    if (!id) {
      let pending = pendingComputers.get(key);
      if (!pending) {
        pending = this.findOrCreateComputer(boxd).finally(() => pendingComputers.delete(key));
        pendingComputers.set(key, pending);
      }
      id = await pending;
      remember(computerIds, key, id);
    }

    if (!preparedComputers.has(id) && (await this.prepareComputer(id, boxd))) {
      remember(preparedComputers, id, true);
    }

    return id;
  }

  private async findOrCreateComputer(boxd: BoxdClient): Promise<string> {
    const sdk = await loadSdk();
    const name = computerName(this.computerKey);

    const existing = await this.findComputer(boxd, name);
    if (existing) return existing;

    let id: string | undefined;
    try {
      const created = await boxd.machines.create(this.createParams(name));
      id = created.id;
      log('created computer %s (%s)', created.name, created.id);
      await boxd.machines.waitUntilReady(created.id);
      await this.closeInbound(created.id, boxd);
      remember(checkedAt, created.id, Date.now());
      return created.id;
    } catch (error) {
      // Another process created it between the lookup and the create.
      if (!id && error instanceof sdk.ConflictError) {
        const adopted = await this.findComputer(boxd, name);
        if (adopted) return adopted;
      }
      if (!id && error instanceof sdk.RateLimitError) {
        throw new MachineLimitError(
          `boxd did not create a computer for this topic: ${error.message}. Every topic used in the last ${leaseTTLSec()} seconds keeps a computer, and each one counts against the boxd organization's machine limit (2 without a payment method on the organization, 50 with one). Add a payment method or ask boxd for a higher limit, or lower BOXD_LEASE_TTL_SEC.`,
        );
      }
      // A computer that came up but could not be closed to inbound traffic is not used.
      if (id) await this.removeComputer(id, boxd);
      throw error;
    }
  }

  private async findComputer(boxd: BoxdClient, name: string) {
    const sdk = await loadSdk();

    try {
      const machine = await boxd.machines.get(name);
      if (machine.status === 'destroyed') return undefined;
      if (machine.status === 'failed') {
        await this.removeComputer(machine.id, boxd);
        return undefined;
      }
      if (machine.status === 'stopped') await boxd.machines.start(machine.id);
      await boxd.machines.waitUntilReady(machine.id);
      remember(checkedAt, machine.id, Date.now());
      return machine.id;
    } catch (error) {
      if (error instanceof sdk.NotFoundError) return undefined;
      throw error;
    }
  }

  private async computerStatus(id: string, boxd: BoxdClient) {
    const sdk = await loadSdk();

    try {
      const { status } = await boxd.machines.get(id);
      return status === 'destroyed' ? 'gone' : status;
    } catch (error) {
      if (error instanceof sdk.NotFoundError) return 'gone';
      throw error;
    }
  }

  private async startComputer(id: string, boxd: BoxdClient) {
    await boxd.machines.start(id);
    await boxd.machines.waitUntilReady(id);
  }

  private async removeComputer(id: string, boxd: BoxdClient) {
    await boxd.machines.delete(id).catch((error) => log('could not delete %s: %O', id, error));
  }

  private createParams(name: string) {
    const leaseSec = leaseTTLSec();
    const common = {
      deleteAfter: leaseSec > 0 ? leaseSec : undefined,
      // Model-written code runs here: isolated strips the boxd CLI, the
      // account's integrations and any route back to the boxd API.
      isolated: true,
      labels: { app: 'lobehub' },
      name,
    };

    // A restore keeps the snapshot's size and SSH setting; closeInbound turns SSH off after.
    if (sandboxEnv.BOXD_SNAPSHOT) {
      return {
        ...common,
        config: { autoSuspendTimeout: IDLE_SUSPEND_SEC },
        fromSnapshot: sandboxEnv.BOXD_SNAPSHOT,
      };
    }

    return {
      ...common,
      config: { autoSuspendTimeout: IDLE_SUSPEND_SEC, ssh: false, vcpu: sandboxEnv.BOXD_VCPU },
    };
  }

  /**
   * SSH off, and bot protection on the computer's public HTTPS address,
   * which boxd gives every machine and cannot remove: only a browser that
   * passes a check gets through, so crawlers that read certificate logs and
   * scripts get a 503 instead of whatever a command left listening.
   */
  private async closeInbound(id: string, boxd: BoxdClient) {
    if (sandboxEnv.BOXD_SNAPSHOT) await boxd.machines.setSsh(id, false);
    await boxd.machines.setBotProtection(id, 'on');
  }

  /** The upload folder belongs to root on a fresh computer; the middleware writes into it as `boxd`. */
  private async prepareComputer(id: string, boxd: BoxdClient) {
    const result = await this.exec(
      id,
      boxd,
      [
        'sh',
        '-c',
        `sudo -n install -d -o boxd -g boxd ${shellQuote(SANDBOX_UPLOADED_FILES_DIR)} && mkdir -p ${shellQuote(WORKSPACE_DIR)}`,
      ],
      { timeoutMs: SETUP_TIMEOUT_MS },
    );

    if (result.exitCode === 0) return true;
    log('could not prepare computer %s (exit %d): %s', id, result.exitCode, result.stderr.trim());
    return false;
  }

  /** Pushes the computer's deletion back while its topic is in use. */
  private async extendLease(id: string, boxd: BoxdClient) {
    const leaseSec = leaseTTLSec();
    if (leaseSec <= 0) return;

    try {
      await boxd.machines.setDeleteAfter(id, leaseSec);
    } catch (error) {
      log('could not extend the lease of %s: %O', id, error);
    }
  }

  private forgetComputer(id: string) {
    const key = this.computerKey;
    if (computerIds.get(key) === id) computerIds.delete(key);
    checkedAt.delete(id);
    preparedComputers.delete(id);
  }

  // ==================== Commands ====================

  private async runCommand(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const command = String(params.command);

    if (params.background === true) return this.startBackgroundCommand(id, boxd, command, params);

    const result = await this.shell(id, boxd, command, {
      cwd: this.cwd(params.cwd),
      env: stringRecord(params.env),
      timeoutMs: timeout(params),
    });

    return {
      result: {
        ...outputSize(result),
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.exitCode === 0,
      },
      success: true,
    };
  }

  /**
   * A background command runs in its own session under `setsid`, so it
   * outlives the exec that started it and `killCommand` can end its whole
   * process group. Its output and exit status go to files in the computer,
   * which is also where `getCommandOutput` keeps how far it has read: the
   * next provider instance may live in another process.
   */
  private async startBackgroundCommand(
    id: string,
    boxd: BoxdClient,
    command: string,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const commandId = `cmd_${randomBytes(8).toString('hex')}`;
    const dir = `${COMMANDS_DIR}/${commandId}`;

    await boxd.machines.fs.write(id, `${dir}/command.sh`, command);
    const runner = [
      'echo $$ > "$1/pid"',
      'date +%s%3N > "$1/started"',
      'sh "$1/command.sh" > "$1/stdout" 2> "$1/stderr" < /dev/null',
      'echo $? > "$1/exit"',
    ].join('; ');
    const started = await this.exec(
      id,
      boxd,
      [
        'sh',
        '-c',
        `setsid sh -c ${shellQuote(runner)} lobe-command ${shellQuote(dir)} > /dev/null 2>&1 < /dev/null &`,
      ],
      { cwd: this.cwd(params.cwd), env: stringRecord(params.env), timeoutMs: SETUP_TIMEOUT_MS },
    );

    if (started.timedOut || started.exitCode !== 0) {
      const reason = started.stderr.trim() || `exit code ${started.exitCode}`;
      return errorResult(`The background command did not start: ${reason}`);
    }

    return {
      result: { commandId, running: true, shell_id: commandId, success: true },
      success: true,
    };
  }

  private async getCommandOutput(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const dir = `${COMMANDS_DIR}/${String(params.commandId)}`;

    return this.runScript(id, boxd, 'output', { dir }, SETUP_TIMEOUT_MS);
  }

  /** Ends the command's whole process group, including children that outlive the command. */
  private async killCommand(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const commandId = String(params.commandId);
    const dir = shellQuote(`${COMMANDS_DIR}/${commandId}`);
    const result = await this.exec(
      id,
      boxd,
      [
        'sh',
        '-c',
        [
          `[ -d ${dir} ] || { echo "Unknown commandId: ${commandId}" >&2; exit 3; }`,
          `pid=$(cat ${dir}/pid 2>/dev/null)`,
          '[ -n "$pid" ] || exit 0',
          `[ -f ${dir}/exit ] || touch ${dir}/killed`,
          'kill -TERM "-$pid" 2>/dev/null || exit 0',
          'sleep 0.5',
          'kill -KILL "-$pid" 2>/dev/null',
          'exit 0',
        ].join('\n'),
      ],
      { timeoutMs: SETUP_TIMEOUT_MS },
    );

    if (result.exitCode !== 0) return errorResult(result.stderr.trim() || 'Failed to kill command');

    return { result: { success: true }, success: true };
  }

  private async executeCode(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const language = String(params.language || 'python');
    const runner = CODE_RUNNERS[language];
    if (!runner) return errorResult(`Unsupported code language for boxd sandbox: ${language}`);

    const file = `${CODE_DIR}/${randomBytes(6).toString('hex')}.${runner.extension}`;
    await boxd.machines.fs.write(id, file, String(params.code || ''));
    const result = await this.shell(id, boxd, runner.run(file), {
      cwd: WORKSPACE_DIR,
      timeoutMs: timeout(params),
    });

    return {
      result: {
        ...outputSize(result),
        error: result.exitCode === 0 ? undefined : result.stderr,
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
      },
      success: true,
    };
  }

  /**
   * Runs a skill's command from its unpacked archive. Archives are fetched
   * once per computer: a marker file in each skill's folder says it is ready.
   */
  private async execScript(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const command = String(params.command);
    const archives = skillArchives(params);
    const names = Object.keys(archives);
    if (names.length === 0) return this.runCommand(id, boxd, { ...params, command });

    const root = `${SKILL_ARCHIVE_CACHE_DIR}/${sha256(JSON.stringify(Object.entries(archives).sort())).slice(0, 32)}`;
    const setup = names.map((name) => {
      const dir = shellQuote(`${root}/${safeName(name)}`);
      const zip = shellQuote(`${root}/${safeName(name)}/skill.zip`);
      return `if [ ! -f ${dir}/.prepared ]; then rm -rf ${dir} && mkdir -p ${dir} && curl -fsSL ${shellQuote(archives[name])} -o ${zip} && unzip -q -o ${zip} -d ${dir} && touch ${dir}/.prepared; fi`;
    });
    const prepared = await this.shell(id, boxd, setup.join(' && '), {
      timeoutMs: timeout(params),
    });

    if (prepared.exitCode !== 0) {
      return {
        error: {
          message: prepared.stderr || prepared.stdout || 'Failed to prepare skill resources',
        },
        result: { exitCode: prepared.exitCode, output: prepared.stdout, stderr: prepared.stderr },
        success: false,
      };
    }

    const skill = activeSkillName(params, archives) ?? names[0];
    const result = await this.shell(id, boxd, command, {
      cwd: `${root}/${safeName(skill)}`,
      env: stringRecord(params.env),
      timeoutMs: timeout(params),
    });

    return {
      result: {
        ...outputSize(result),
        exitCode: result.exitCode,
        output: result.stdout,
        stderr: result.stderr,
        stdout: result.stdout,
        success: result.exitCode === 0,
      },
      success: true,
    };
  }

  /**
   * A shell line the model wrote, run through `cappedRunner` so each output
   * stream is cut inside the computer, and a timeout turned into exit code
   * 124 the model can act on.
   */
  private async shell(
    id: string,
    boxd: BoxdClient,
    command: string,
    options: { cwd?: string; env?: Record<string, string>; timeoutMs: number },
  ): Promise<ShellOutcome> {
    const result = await this.exec(
      id,
      boxd,
      ['sh', '-c', cappedRunner, 'lobe-exec', command],
      options,
    );

    if (result.timedOut) {
      const message = `Command timed out after ${options.timeoutMs} ms and was stopped. Run long commands with background: true, then poll getCommandOutput.`;
      return { ...result, stderr: message, truncated: false };
    }

    const header = /^(\d+) (\d+) (\d+)\n/.exec(result.stdout);
    // No header: the runner did not run (the computer is gone, or /tmp is not writable).
    if (!header) return { ...result, truncated: false };

    const stdoutBytes = Number(header[2]);
    const stderrBytes = Number(header[3]);
    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stderrBytes,
      stdout: result.stdout.slice(header[0].length),
      stdoutBytes,
      truncated: stdoutBytes > OUTPUT_LIMIT_BYTES || stderrBytes > OUTPUT_LIMIT_BYTES,
    };
  }

  /**
   * One exec, argv form. The SDK prefixes `env` onto the command line as
   * assignments, so argv puts them on the `sh` that runs the line, where
   * `$VAR` expands. A timeout ends the call and the remote command.
   */
  private async exec(
    id: string,
    boxd: BoxdClient,
    command: string[],
    { cwd, env, timeoutMs }: { cwd?: string; env?: Record<string, string>; timeoutMs: number },
  ): Promise<ExecOutcome> {
    try {
      const result = await boxd.machines.exec(id, { command, cwd, env, timeout: timeoutMs });
      if (result.exitCode === -1 && (await this.computerStatus(id, boxd)) === 'gone') {
        throw new ComputerGoneError(`computer ${id} is gone`);
      }
      return { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout };
    } catch (error) {
      if (isExecTimeout(error)) {
        return { exitCode: TIMEOUT_EXIT_CODE, stderr: '', stdout: '', timedOut: true };
      }
      throw error;
    }
  }

  // ==================== Files ====================

  private async listFiles(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const directory = this.resolvePath(params.directoryPath ?? params.path, params.cwd);
    const entries = await boxd.machines.fs.list(id, directory);

    const files = entries.map((entry) => ({
      isDirectory: entry.isDir,
      modifiedTime: entry.mtime?.toISOString(),
      mtime: entry.mtime ? entry.mtime.getTime() / 1000 : undefined,
      name: entry.name,
      path: entry.path,
      size: entry.size,
    }));

    const sortBy = String(params.sortBy || 'name');
    files.sort((left, right) => {
      if (sortBy === 'size') return left.size - right.size;
      if (sortBy === 'modifiedTime' || sortBy === 'date' || sortBy === 'mtime') {
        return (left.mtime ?? 0) - (right.mtime ?? 0);
      }
      return left.name.localeCompare(right.name);
    });
    if (params.sortOrder === 'desc') files.reverse();

    const limit = typeof params.limit === 'number' && params.limit > 0 ? params.limit : undefined;

    return {
      result: { files: limit ? files.slice(0, limit) : files, totalCount: files.length },
      success: true,
    };
  }

  /** A file up to the read cap comes over whole; a bigger one is windowed inside the computer. */
  private async readFile(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const path = this.resolvePath(params.path, params.cwd);
    const start = typeof params.startLine === 'number' ? params.startLine : undefined;
    const end = typeof params.endLine === 'number' ? params.endLine : undefined;

    const entry = await boxd.machines.fs.stat(id, path);
    if (entry.isDir) return errorResult(`${path} is a directory`);
    if (entry.size > READ_FILE_LIMIT_CHARS) {
      return this.runScript(id, boxd, 'read', {
        endLine: end,
        limit: READ_FILE_LIMIT_CHARS,
        path,
        startLine: start,
      });
    }

    const text = new TextDecoder().decode(await boxd.machines.fs.read(id, path));
    const lines = text === '' ? [] : text.split(/(?<=\n)/);
    const content =
      start === undefined && end === undefined
        ? text
        : lines.slice(Math.max((start ?? 1) - 1, 0), end ?? lines.length).join('');

    return {
      result: {
        charCount: content.length,
        content,
        filename: posixPath.basename(path),
        totalCharCount: text.length,
        totalLineCount: lines.length,
      },
      success: true,
    };
  }

  private async writeFile(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const content = String(params.content ?? '');
    await boxd.machines.fs.write(id, this.resolvePath(params.path, params.cwd), content);

    return {
      result: { bytesWritten: Buffer.byteLength(content), success: true },
      success: true,
    };
  }

  private async editFile(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const search = String(params.search);
    const replace = String(params.replace ?? '');

    const path = this.resolvePath(params.path, params.cwd);
    const text = new TextDecoder().decode(await boxd.machines.fs.read(id, path));
    const occurrences = text.split(search).length - 1;

    if (occurrences === 0) {
      return {
        error: { message: 'search text not found' },
        result: { replacements: 0, success: false },
        success: false,
      };
    }

    const all = params.all === true;
    await boxd.machines.fs.write(
      id,
      path,
      all ? text.replaceAll(search, replace) : text.replace(search, () => replace),
    );

    return {
      result: {
        linesAdded: replace.split('\n').length - 1,
        linesDeleted: search.split('\n').length - 1,
        replacements: all ? occurrences : 1,
        success: true,
      },
      success: true,
    };
  }

  private async moveFiles(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const operations = Array.isArray(params.operations) ? params.operations.filter(isRecord) : [];
    const results = [];

    for (const operation of operations) {
      const source = this.resolvePath(operation.source, params.cwd);
      let destination = this.resolvePath(operation.destination, params.cwd);

      try {
        const target = await boxd.machines.fs.stat(id, destination).catch(() => undefined);
        if (target?.isDir) destination = posixPath.join(destination, posixPath.basename(source));
        await boxd.machines.fs.rename(id, source, destination, { overwrite: true });
        results.push({ destination, source, success: true });
      } catch (error) {
        results.push({ destination, error: (error as Error).message, source, success: false });
      }
    }

    return {
      result: { results, successCount: results.filter((result) => result.success).length },
      success: true,
    };
  }

  private async renameFile(
    id: string,
    boxd: BoxdClient,
    params: Record<string, unknown>,
  ): Promise<SandboxCallToolResult> {
    const newName = String(params.newName);
    const oldPath = this.resolvePath(params.oldPath, params.cwd);
    const newPath = posixPath.join(posixPath.dirname(oldPath), newName);
    await boxd.machines.fs.rename(id, oldPath, newPath);

    return { result: { newPath, success: true }, success: true };
  }

  /** Python inside the computer, one exec per call; the script keeps its output under the caps. */
  private async runScript(
    id: string,
    boxd: BoxdClient,
    operation: 'export' | 'glob' | 'grep' | 'output' | 'read' | 'search',
    params: Record<string, unknown>,
    timeoutMs = timeout(params),
  ): Promise<SandboxCallToolResult> {
    const walksTree = operation === 'glob' || operation === 'grep' || operation === 'search';
    const args = walksTree
      ? { ...params, directory: this.resolvePath(params.directory ?? params.path, params.cwd) }
      : params;

    const result = await this.exec(id, boxd, ['python3', '-c', boxdToolScript], {
      cwd: WORKSPACE_DIR,
      env: { LOBE_BOXD_ARGS: JSON.stringify(args), LOBE_BOXD_OPERATION: operation },
      timeoutMs,
    });

    if (result.timedOut) return errorResult(`${operation} did not finish within ${timeoutMs} ms`);
    if (result.exitCode !== 0) {
      return errorResult(result.stderr.trim() || result.stdout.trim() || `${operation} failed`);
    }

    let output: Record<string, unknown>;
    try {
      output = JSON.parse(result.stdout || '{}') as Record<string, unknown>;
    } catch {
      return errorResult(`${operation} returned output that is not JSON`);
    }

    if (output.success === false) {
      return {
        error: { message: String(output.error || `${operation} failed`) },
        result: output,
        success: false,
      };
    }

    return { result: output, success: true };
  }

  // ==================== Paths ====================

  private cwd(cwd: unknown) {
    if (typeof cwd !== 'string' || !cwd) return WORKSPACE_DIR;
    return posixPath.isAbsolute(cwd)
      ? posixPath.normalize(cwd)
      : posixPath.join(WORKSPACE_DIR, cwd);
  }

  /** Relative paths resolve against the working directory, like the shell's. */
  private resolvePath(path: unknown, cwd?: unknown) {
    const value = typeof path === 'string' && path ? path : '.';
    if (value === '~') return HOME_DIR;
    if (value.startsWith('~/')) return posixPath.join(HOME_DIR, value.slice(2));
    if (posixPath.isAbsolute(value)) return posixPath.normalize(value);
    return posixPath.join(this.cwd(cwd), value);
  }
}

const PATH_TOOLS = new Set([
  'editFile',
  'editLocalFile',
  'readFile',
  'readLocalFile',
  'writeFile',
  'writeLocalFile',
]);

/** Checked before any computer is looked up or created for the call. */
const invalidParams = (toolName: string, params: Record<string, unknown>) => {
  const needsCommand = toolName === 'runCommand' || toolName === 'execScript';
  if (needsCommand && (typeof params.command !== 'string' || !params.command.trim())) {
    return 'command is required';
  }
  if (toolName === 'getCommandOutput' || toolName === 'killCommand') {
    const commandId = String(params.commandId ?? '');
    if (!COMMAND_ID_PATTERN.test(commandId)) return `Unknown commandId: ${commandId}`;
  }
  if (PATH_TOOLS.has(toolName) && (typeof params.path !== 'string' || !params.path)) {
    return 'path is required';
  }
  if ((toolName === 'editFile' || toolName === 'editLocalFile') && !params.search) {
    return 'search is required';
  }
  if (toolName === 'renameLocalFile') {
    const newName = String(params.newName ?? '');
    if (!newName || newName.includes('/')) return 'newName must be a file name';
    if (typeof params.oldPath !== 'string' || !params.oldPath) return 'oldPath is required';
  }
  return undefined;
};

const computerName = (key: string) => `lobehub-${sha256(key).slice(0, 20)}`;

const leaseTTLSec = () => sandboxEnv.BOXD_LEASE_TTL_SEC ?? DEFAULT_LEASE_TTL_SEC;

const timeout = (params: Record<string, unknown>) => {
  const value = params.timeout ?? params.timeout_ms;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_TIMEOUT_MS;
};

const isExecTimeout = (error: unknown) =>
  error instanceof Error &&
  (error as { grpcCode?: unknown }).grpcCode === undefined &&
  /exec timed out/i.test(error.message);

/** Total stream sizes, on a result whose output was cut. */
const outputSize = (result: ShellOutcome) =>
  result.truncated
    ? { stderrBytes: result.stderrBytes, stdoutBytes: result.stdoutBytes, truncated: true }
    : {};

/** String values under names a shell accepts; the SDK puts them on the command line as `NAME=value`. */
const stringRecord = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && ENV_NAME_PATTERN.test(entry[0]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const safeName = (name: string) => name.replaceAll(/[^\w.-]/g, '-');

const skillArchives = (params: Record<string, unknown>): Record<string, string> => {
  if (typeof params.zipUrl === 'string' && params.zipUrl) {
    return { [activeSkillName(params, {}) ?? 'default']: params.zipUrl };
  }
  if (!isRecord(params.skillZipUrls)) return {};

  return Object.fromEntries(
    Object.entries(params.skillZipUrls).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1],
    ),
  );
};

/**
 * The skill a command runs for: the configured one, else the most recently
 * activated one. With archives given, only a name that has one counts.
 */
const activeSkillName = (params: Record<string, unknown>, archives: Record<string, string>) => {
  const known = (name: unknown): name is string =>
    typeof name === 'string' && !!name && (Object.keys(archives).length === 0 || name in archives);

  const configName = isRecord(params.config) ? params.config.name : undefined;
  if (known(configName)) return configName;

  if (Array.isArray(params.activatedSkills)) {
    for (const skill of [...params.activatedSkills].reverse()) {
      if (isRecord(skill) && known(skill.name)) return skill.name;
    }
  }

  return undefined;
};

function errorResult(message: string, name?: string): SandboxCallToolResult {
  return { error: { message, name }, result: null, success: false };
}
