import { createHmac, randomUUID } from 'node:crypto';

import { Sandbox } from '@e2b/code-interpreter';
import type { SandboxCallToolResult } from '@lobechat/builtin-tool-cloud-sandbox';
import debug from 'debug';

import { sandboxEnv } from '@/envs/sandbox';

import type {
  SandboxProvider,
  SandboxProviderCallContext,
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
const EXPORT_TIMEOUT_MS = 300_000;
const CONTROL_PLANE_TIMEOUT_MS = 30_000;
const BACKGROUND_LAUNCH_TIMEOUT_MS = 10_000;
const BACKGROUND_CONTROL_TIMEOUT_MS = 10_000;
const TEMP_FILE_CLEANUP_TIMEOUT_MS = 10_000;
const BACKGROUND_OUTPUT_CHUNK_BYTES = 256 * 1024;
const BACKGROUND_KILL_GRACE_SEC = 1;
const BACKGROUND_COMPLETED_LIMIT = 1024;
const ENVD_PORT = '49983';
const ENVD_FALLBACK_VERSION = '0.2.4';
const TSX_VERSION = '4.22.4';
const INSTANCE_OPERATION_HEADROOM_MS = 60_000;
const INSTANCE_OPERATION_START_MARGIN_MS = 5000;
const MAX_INSTANCE_TIMEOUT_SEC = 3600;
const MAX_INSTANCE_OPERATION_TIMEOUT_MS =
  MAX_INSTANCE_TIMEOUT_SEC * 1000 - INSTANCE_OPERATION_HEADROOM_MS;
const BACKGROUND_DIR = '/tmp/lobe-background';
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANCE_CACHE_LIMIT = 1024;
const INSTANCE_HISTORY_LIMIT = 4096;

/**
 * Prepares the background directory and bounds retained completion history.
 * Active jobs have no `.exit` marker and are never considered for pruning.
 */
const prepareBackgroundDirectoryScript = `${scriptPrelude}
def main(encoded):
    directory = Path('${BACKGROUND_DIR}')
    directory.mkdir(parents=True, exist_ok=True)
    completed = []
    for marker in directory.glob('*.exit'):
        try:
            completed.append((marker.stat().st_mtime, marker))
        except FileNotFoundError:
            pass

    # Leave room for the command being launched, so completion never takes the
    # retained history above the configured limit in the sequential case.
    for _, marker in sorted(completed, reverse=True)[${BACKGROUND_COMPLETED_LIMIT - 1}:]:
        base = marker.with_suffix('')
        for suffix in ('.sh', '.log', '.pid', '.pgid', '.exit', '.off', '.timedout'):
            try:
                base.with_suffix(suffix).unlink()
            except FileNotFoundError:
                pass

    emit({'success': True})
`;

/**
 * Reads whatever a background command has produced since the previous check.
 *
 * The tool contract is a polling one — callers ask repeatedly for *new* output
 * while the process keeps running — so this must never block on completion.
 * Progress is tracked with an offset file next to the log.
 */
const backgroundStatusScript = `${scriptPrelude}
import codecs
def main(encoded):
    args = load_args(encoded)
    base = Path('${BACKGROUND_DIR}') / str(args.get('commandId') or '')
    log, pid_file = base.with_suffix('.log'), base.with_suffix('.pid')
    exit_file, off_file = base.with_suffix('.exit'), base.with_suffix('.off')

    if not log.exists() and not pid_file.exists() and not exit_file.exists():
        emit({'success': False, 'error': 'unknown commandId'})
        return

    offset = int(off_file.read_text()) if off_file.exists() else 0
    exit_code = None
    if exit_file.exists():
        text = exit_file.read_text().strip()
        exit_code = int(text) if text else None

    output = ''
    has_more = False
    if log.exists():
        try:
            with log.open('rb') as handle:
                handle.seek(offset)
                chunk = handle.read(${BACKGROUND_OUTPUT_CHUNK_BYTES})
                handle.seek(0, os.SEEK_END)
                log_size = handle.tell()

                # Keep a partial UTF-8 sequence for the next poll rather than
                # replacing a valid character merely because it crosses the
                # byte chunk boundary. Invalid completed bytes still decode
                # with replacement, preserving the existing text contract.
                decoder = codecs.getincrementaldecoder('utf-8')('replace')
                output = decoder.decode(
                    chunk,
                    final=exit_code is not None and offset + len(chunk) >= log_size,
                )
                pending, _ = decoder.getstate()
                next_offset = offset + len(chunk) - len(pending)
                has_more = next_offset < log_size
                off_file.write_text(str(next_offset))
        except FileNotFoundError:
            pass

    running = False
    pgid_file = base.with_suffix('.pgid')
    probe = pgid_file if pgid_file.exists() else pid_file
    if exit_code is None and probe.exists():
        try:
            process_id = int(probe.read_text().strip())
            if pgid_file.exists():
                os.killpg(process_id, 0)
            else:
                os.kill(process_id, 0)
            running = True
        except (OSError, ValueError):
            running = False

    if exit_code is not None and not has_more:
        # Once the final bytes have been consumed, retain only the tiny exit
        # marker so repeated polls stay idempotent without keeping commands,
        # logs, offsets, or stale process identifiers forever.
        for suffix in ('.sh', '.log', '.pid', '.pgid', '.off', '.timedout'):
            try:
                base.with_suffix(suffix).unlink()
            except FileNotFoundError:
                pass

    # The monitor owns publication of the authoritative exit status. A poll
    # can land after the process group disappears but before that atomic
    # handoff, so a published PID/PGID without an exit marker is still pending.
    # Preserve the old not-found result for ids that have no state at all.
    awaiting_exit = exit_code is None and probe.exists()
    reported_running = running or awaiting_exit or has_more
    reported_exit_code = None if has_more else exit_code
    emit({
        'exitCode': reported_exit_code,
        'hasMore': has_more,
        'newOutput': output,
        'output': output,
        'running': reported_running,
        'stderr': '',
        'success': reported_running or reported_exit_code == 0,
    })
`;

/**
 * Uploads a sandbox file straight to the presigned URL from inside the
 * sandbox. Reading the artifact into the Node process first would let a large
 * export exhaust server memory and disturb unrelated requests.
 */
const uploadFileScript = `${scriptPrelude}
import urllib.request

def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path') or '')
    if not path.exists():
        emit({'success': False, 'error': 'file not found: %s' % path})
        return

    size = path.stat().st_size
    with path.open('rb') as body:
        request = urllib.request.Request(
            args.get('uploadUrl'), data=body, method='PUT',
            headers={**(args.get('headers') or {}), 'Content-Length': str(size)})
        try:
            with urllib.request.urlopen(request, timeout=${EXPORT_TIMEOUT_MS / 1000}) as response:
                status = response.status
        except Exception as error:
            emit({'success': False, 'error': str(error)})
            return

    emit({'success': True, 'size': size, 'status': status})
`;

const killBackgroundScript = `${scriptPrelude}
import signal, time

def main(encoded):
    args = load_args(encoded)
    base = Path('${BACKGROUND_DIR}') / str(args.get('commandId') or '')
    exit_file = base.with_suffix('.exit')
    pgid_file, pid_file = base.with_suffix('.pgid'), base.with_suffix('.pid')

    if exit_file.exists():
        emit({'forced': False, 'success': True})
        return

    if not pgid_file.exists() and not pid_file.exists():
        emit({'success': False, 'error': 'unknown commandId'})
        return

    # The launcher normally publishes the command pgid before returning. Wait
    # briefly as a compatibility fallback for jobs started by older versions.
    deadline = time.monotonic() + 1
    while not pgid_file.exists() and pid_file.exists() and time.monotonic() < deadline:
        time.sleep(0.05)

    try:
        if pgid_file.exists():
            process_id = int(pgid_file.read_text().strip())
            signal_target = lambda sig: os.killpg(process_id, sig)
        else:
            process_id = int(pid_file.read_text().strip())
            signal_target = lambda sig: os.kill(process_id, sig)
    except (OSError, ValueError) as error:
        emit({'success': False, 'error': str(error)})
        return

    def is_alive():
        try:
            signal_target(0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    if not is_alive():
        emit({'forced': False, 'success': True})
        return

    # Manual cancellation must own the same bounded escalation as the timeout
    # path. Killing only the timeout group leader leaves TERM-resistant
    # descendants running after their watchdog is gone.
    try:
        signal_target(signal.SIGTERM)
    except ProcessLookupError:
        emit({'forced': False, 'success': True})
        return
    except OSError as error:
        emit({'success': False, 'error': str(error)})
        return

    deadline = time.monotonic() + ${BACKGROUND_KILL_GRACE_SEC}
    while time.monotonic() < deadline:
        if not is_alive():
            emit({'forced': False, 'success': True})
            return
        time.sleep(0.05)

    try:
        signal_target(signal.SIGKILL)
    except ProcessLookupError:
        emit({'forced': False, 'success': True})
        return
    except OSError as error:
        emit({'success': False, 'error': str(error)})
        return

    emit({'forced': True, 'success': True})
`;

interface DispatchResult {
  error?: { message: string; name?: string };
  result: unknown;
  success: boolean;
}

interface AcquiredInstance {
  domain: string;
  envdVersion: string;
  expiresAt: number;
  instanceId: string;
  token: string;
  trafficToken?: string;
}

interface ResolvedInstance {
  instance: AcquiredInstance;
  sessionExpiredAndRecreated: boolean;
}

/**
 * A local connection cache avoids repeated control-plane calls in one server
 * process. It is not the session source of truth: `acquire` receives a stable,
 * opaque ConversationId, and Tencent's control plane owns the one-conversation /
 * one-instance mapping. A replica or cold-started process therefore reacquires
 * connection credentials for the existing instance instead of depending on
 * this map for persistence.
 */
const instances = new Map<string, AcquiredInstance>();
/**
 * Bounded, id-only history preserves reset detection after expired credentials
 * are evicted from the live cache.
 */
const instanceHistory = new Map<string, string>();
/**
 * In-flight acquisitions, so two concurrent tool calls for one session share a
 * container instead of racing and leaking the loser.
 */
const pending = new Map<string, Promise<ResolvedInstance>>();

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
    context?: SandboxProviderCallContext,
  ): Promise<SandboxCallToolResult> {
    const configError = this.checkConfig();
    if (configError) return configError;

    try {
      // Middleware bootstrap calls reserve the lifetime needed by the tool
      // that follows, while dispatch still receives the bootstrap's original
      // parameters and therefore keeps its own shorter execution timeout.
      const operationTimeoutMs = this.operationTimeoutMs(toolName, params);
      const reserveForTimeoutMs = context?.reserveFor
        ? this.operationTimeoutMs(context.reserveFor.toolName, context.reserveFor.params)
        : 0;
      // Do not let a valid bootstrap become an invalid request just because
      // the sequential reservation exceeds Tencent's hard instance limit. A
      // near-limit follow-up is admitted only if enough lifetime actually
      // remains after bootstrap; otherwise the normal on-demand check rejects
      // it instead of silently running without initialized files.
      const lifetimeBudgetMs =
        reserveForTimeoutMs > 0 && operationTimeoutMs <= MAX_INSTANCE_OPERATION_TIMEOUT_MS
          ? Math.min(operationTimeoutMs + reserveForTimeoutMs, MAX_INSTANCE_OPERATION_TIMEOUT_MS)
          : operationTimeoutMs;
      const { sandbox, sessionExpiredAndRecreated } = await this.connect(lifetimeBudgetMs);
      const { error, result, success } = await this.dispatch(sandbox, toolName, params);

      // `error` has to survive: the runtime builds the model-visible failure
      // content from it, and dropping it here left the model with `undefined`.
      return { error, result, sessionExpiredAndRecreated, success };
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
      const { sandbox } = await this.connect(EXPORT_TIMEOUT_MS);
      const uploaded = await this.runScript(
        sandbox,
        uploadFileScript,
        {
          headers: uploadHeaders ?? {},
          path,
          uploadUrl,
        },
        { timeoutMs: EXPORT_TIMEOUT_MS },
      );

      return { size: Number(uploaded.size ?? 0), success: true };
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
  ): Promise<DispatchResult> {
    const ok = (result: unknown): DispatchResult => ({ result, success: true });

    switch (toolName) {
      case 'executeCode': {
        const code = String(params.code ?? '');
        const language = String(params.language ?? 'python');

        // EdgeOne's E2B-compatible Jupyter service uses `js` for its
        // JavaScript kernel and does not expose a TypeScript kernel. Execute
        // TypeScript with a pinned runner instead of advertising support and
        // then forwarding an invalid kernel identifier.
        if (language === 'typescript') {
          const scriptPath = `/home/user/.lobe-execute-${randomUUID()}.mts`;
          await sandbox.files.write(scriptPath, code);

          const execution = await (async () => {
            try {
              return await sandbox.commands.run(`npx --yes tsx@${TSX_VERSION} ${scriptPath}`, {
                timeoutMs: this.timeoutMs(params),
              });
            } finally {
              // A command-level timeout or transport rejection prevents any
              // shell suffix from running, so cleanup must be a separate call.
              // Never mask the original execution result if cleanup itself
              // fails; the generated path contains only a trusted UUID.
              try {
                const cleanup = await sandbox.commands.run(`rm -f ${scriptPath}`, {
                  timeoutMs: TEMP_FILE_CLEANUP_TIMEOUT_MS,
                });
                if (cleanup.exitCode !== 0) {
                  log('Failed to clean up TypeScript temp file %s: %s', scriptPath, cleanup.stderr);
                }
              } catch (error) {
                log('Failed to clean up TypeScript temp file %s: %O', scriptPath, error);
              }
            }
          })();
          const executionError =
            execution.exitCode === 0
              ? undefined
              : execution.stderr ||
                execution.error ||
                `TypeScript exited with code ${execution.exitCode}`;

          return {
            result: {
              error: executionError,
              output: execution.stdout,
              results: [],
              stderr: execution.stderr,
              stdout: execution.stdout,
            },
            success: !executionError,
            ...(executionError
              ? { error: { message: executionError, name: 'ExecutionError' } }
              : {}),
          };
        }

        const execution = await sandbox.runCode(code, {
          language: language === 'javascript' ? 'js' : language,
        });

        const stdout = execution.logs.stdout.join('');
        const stderr = execution.logs.stderr.join('');

        // The runtime renders `output` and takes the status from the outer
        // envelope, so a raised exception has to fail the call itself.
        return {
          result: {
            error: execution.error ? execution.error.value : undefined,
            output: stdout,
            results: execution.results,
            stderr,
            stdout,
          },
          success: !execution.error,
          // The runtime builds the model-visible content from the outer error
          // on failure; without it the model sees `undefined` and cannot tell
          // what went wrong.
          ...(execution.error
            ? { error: { message: String(execution.error.value), name: 'ExecutionError' } }
            : {}),
        };
      }

      case 'runCommand': {
        return ok(await this.runCommand(sandbox, params));
      }

      case 'getCommandOutput': {
        // A finished-but-failed command legitimately reports success: false
        // together with its output and exit code; that is a status, not a
        // helper malfunction, so it must reach the caller intact.
        return ok(
          await this.runScript(
            sandbox,
            backgroundStatusScript,
            { commandId: this.commandId(params) },
            { allowReportedFailure: true, timeoutMs: BACKGROUND_CONTROL_TIMEOUT_MS },
          ),
        );
      }

      case 'killCommand': {
        return ok(
          await this.runScript(
            sandbox,
            killBackgroundScript,
            { commandId: this.commandId(params) },
            { allowReportedFailure: true, timeoutMs: BACKGROUND_CONTROL_TIMEOUT_MS },
          ),
        );
      }

      case 'writeFile':
      case 'writeLocalFile': {
        return ok(await this.writeFile(sandbox, params));
      }

      case 'listFiles':
      case 'listLocalFiles': {
        return ok(await this.runScript(sandbox, listFilesScript, params));
      }

      case 'readFile':
      case 'readLocalFile': {
        return ok(await this.runScript(sandbox, readFileScript, params));
      }

      case 'editFile':
      case 'editLocalFile': {
        return ok(await this.runScript(sandbox, editFileScript, params));
      }

      case 'searchFiles':
      case 'searchLocalFiles': {
        return ok(await this.runScript(sandbox, searchFilesScript, params));
      }

      case 'moveFiles':
      case 'moveLocalFiles': {
        return ok(await this.runScript(sandbox, moveFilesScript, params));
      }

      case 'globFiles':
      case 'globLocalFiles': {
        return ok(await this.runScript(sandbox, globFilesScript, params));
      }

      case 'grepContent': {
        return ok(await this.runScript(sandbox, grepContentScript, params));
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
      const timeoutMs = this.timeoutMs(params);
      const timeoutSec = timeoutMs / 1000;

      // Create the parent before files.write and prune only completed history.
      // The bounded control timeout is independent of the command's lifetime.
      await this.runScript(
        sandbox,
        prepareBackgroundDirectoryScript,
        {},
        {
          timeoutMs: BACKGROUND_LAUNCH_TIMEOUT_MS,
        },
      );

      // The command is written to a file rather than interpolated into the
      // launcher: anything with quotes — `printf '%s' 'hello world'` — would
      // otherwise terminate the wrapper's own quoting and break or mutate it.
      await sandbox.files.write(`${base}.sh`, String(params.command ?? ''));

      // The outer `setsid` detaches the monitor shell. GNU timeout, without
      // `--foreground`, then creates a separate process group for itself and
      // the command tree. `$!` is both timeout's pid and that group's pgid, so
      // manual cancellation and the deadline target the real command group.
      // A command can exit after daemonizing or backgrounding a child, which
      // also makes GNU timeout exit before its deadline. The independent
      // monitor therefore retains responsibility for the entire group until
      // it is empty, using a separately killable sleep as its deadline timer.
      // This avoids leaking the sleep when a short command finishes early and
      // publishes a timeout marker before terminating an overlong group.
      // `group_alive` ignores zombies because they cannot execute and may wait
      // indefinitely for the sandbox's PID 1 to reap them.
      // The launcher also has to detach every fd, otherwise the caller's
      // `commands.run` waits for the detached process to close stdout.
      const launch =
        `setsid sh -c 'group_alive() { ` +
        `ps -eo pgid=,stat= | awk -v target=$command_pgid ` +
        `"\\$1 == target && \\$2 !~ /^Z/ { found=1 } END { exit !found }"; ` +
        `}; timer_alive() { ` +
        `ps -o stat= -p "$1" | awk ` +
        `"\\$1 !~ /^Z/ { found=1 } END { exit !found }"; ` +
        `}; ` +
        `timeout --kill-after=5s ${timeoutSec}s sh ${base}.sh ` +
        `> ${base}.log 2>&1 & command_pgid=$!; ` +
        `echo $command_pgid > ${base}.pgid; ` +
        `sleep ${timeoutSec} & deadline_pid=$!; ` +
        `while group_alive && timer_alive $deadline_pid; do sleep 0.05; done; ` +
        `if group_alive; then ` +
        `wait $deadline_pid 2>/dev/null || true; ` +
        `echo 1 > ${base}.timedout; ` +
        // dash's kill builtin rejects `--`; the id comes from `$!`, so it is
        // always a positive decimal and safe to negate as a group target.
        `kill -TERM -$command_pgid 2>/dev/null || true; ` +
        `sleep 5 & grace_pid=$!; ` +
        `while group_alive && timer_alive $grace_pid; do sleep 0.05; done; ` +
        `if group_alive; then kill -KILL -$command_pgid 2>/dev/null || true; ` +
        `else kill $grace_pid 2>/dev/null || true; fi; ` +
        `wait $grace_pid 2>/dev/null || true; ` +
        `else kill $deadline_pid 2>/dev/null || true; ` +
        `wait $deadline_pid 2>/dev/null || true; fi; ` +
        `wait $command_pgid; command_status=$?; ` +
        `while group_alive; do sleep 0.05; done; ` +
        `if [ -f ${base}.timedout ]; then command_status=124; fi; ` +
        `echo $command_status > ${base}.exit' ` +
        `< /dev/null > /dev/null 2>&1 & ` +
        `monitor_pid=$!; echo $monitor_pid > ${base}.pid; ` +
        `attempts=0; ` +
        `while [ ! -s ${base}.pgid ] && kill -0 $monitor_pid 2>/dev/null && ` +
        `[ $attempts -lt 100 ]; do ` +
        `attempts=$((attempts + 1)); sleep 0.01; ` +
        `done; test -s ${base}.pgid`;

      const result = await sandbox.commands.run(launch, {
        cwd: params.cwd as string | undefined,
        // Starting and publishing the process group is control work. A tiny
        // command timeout must not interrupt it and leave an untracked job.
        timeoutMs: BACKGROUND_LAUNCH_TIMEOUT_MS,
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
    options: { allowReportedFailure?: boolean; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    const result = await sandbox.commands.run(buildScriptCommand(script, params), {
      timeoutMs: options.timeoutMs ?? this.timeoutMs(params),
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || 'Sandbox script failed');
    }

    const parsed = JSON.parse(result.stdout || '{}') as Record<string, unknown>;

    if (parsed.success === false && !options.allowReportedFailure) {
      throw new Error(String(parsed.error || 'Sandbox script failed'));
    }

    return parsed;
  }

  private commandId(params: Record<string, unknown>): string {
    const id = String(params.commandId ?? params.shell_id ?? '').trim();

    if (!COMMAND_ID_PATTERN.test(id)) {
      throw new Error('commandId must be a sandbox-issued UUID');
    }

    return id;
  }

  private timeoutMs(params: Record<string, unknown>): number {
    const value = params.timeout ?? params.timeout_ms;

    if (value === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;

    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('timeout must be a positive finite number of milliseconds');
    }

    return value;
  }

  private operationTimeoutMs(toolName: string, params: Record<string, unknown>): number {
    // Polling and cancellation are bounded control-plane helpers, not another
    // full command workload. Reserving the 120-second command default here
    // can make an on-demand background job impossible to observe or stop near
    // the end of its backend-confirmed lifetime.
    if (toolName === 'getCommandOutput' || toolName === 'killCommand') {
      return BACKGROUND_CONTROL_TIMEOUT_MS;
    }

    return this.timeoutMs(params);
  }

  // ---------------------------------------------------------------------------
  // Instance lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Returns a client for this session's instance, acquiring or renewing one as
   * needed.
   *
   * `persistent` renews before expiry so a topic keeps its container.
   * `on-demand` never renews; it lets the backend-confirmed lifetime lapse and
   * acquires a fresh instance afterwards. Acquisition reserves enough time for
   * the current operation, and a near-expiry instance is not given new work
   * that it cannot finish.
   */
  private async connect(
    operationTimeoutMs: number,
  ): Promise<ResolvedInstance & { sandbox: Sandbox }> {
    const resolved = await this.acquireForSession(operationTimeoutMs);

    return {
      ...resolved,
      sandbox: connect(resolved.instance),
    };
  }

  /**
   * The local promise only coalesces calls in this process. Cross-process
   * ownership and deduplication are provided by acquire's ConversationId.
   */
  private async acquireForSession(operationTimeoutMs: number): Promise<ResolvedInstance> {
    const key = this.sessionKey();
    const inFlight = pending.get(key);

    if (inFlight) {
      const shared = await inFlight;

      // A concurrent short operation may have started the acquisition. Once it
      // settles, re-evaluate a longer caller instead of inheriting credentials
      // that do not cover its requested lifetime.
      const canReuseShared =
        sandboxEnv.TENCENT_SANDBOX_MODE === 'on-demand'
          ? this.hasOperationLifetime(shared.instance, operationTimeoutMs)
          : this.hasRequiredLifetime(shared.instance, operationTimeoutMs);
      if (canReuseShared) {
        return shared;
      }

      const resolved = await this.acquireForSession(operationTimeoutMs);
      return {
        ...resolved,
        sessionExpiredAndRecreated:
          shared.sessionExpiredAndRecreated || resolved.sessionExpiredAndRecreated,
      };
    }

    const promise = this.resolveInstance(key, operationTimeoutMs).finally(() =>
      pending.delete(key),
    );
    pending.set(key, promise);

    return promise;
  }

  private async resolveInstance(
    key: string,
    operationTimeoutMs: number,
  ): Promise<ResolvedInstance> {
    this.compactInstanceCache(key);

    const cached = instances.get(key);
    const requestedTimeoutSec = this.requestedInstanceTimeoutSec(operationTimeoutMs);

    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        return this.reacquireExpired(key, cached, operationTimeoutMs, requestedTimeoutSec);
      }

      // On-demand instances are never renewed or released early because that
      // would strand session state. Do not start work that cannot finish in
      // the remaining lifetime; the caller can retry with a shorter deadline
      // or after the control plane expires and reacquires the conversation.
      if (sandboxEnv.TENCENT_SANDBOX_MODE === 'on-demand') {
        if (!this.hasOperationLifetime(cached, operationTimeoutMs)) {
          throw new Error(
            'On-demand sandbox remaining lifetime is shorter than the requested operation timeout',
          );
        }

        this.rememberInstance(key, cached);
        return { instance: cached, sessionExpiredAndRecreated: false };
      }

      if (this.hasRequiredLifetime(cached, operationTimeoutMs)) {
        this.rememberInstance(key, cached);
        return { instance: cached, sessionExpiredAndRecreated: false };
      }

      const renewed = await this.renew(cached, requestedTimeoutSec);
      if (renewed) {
        this.rememberInstance(key, renewed);
        this.assertOperationLifetime(renewed, operationTimeoutMs, 'renewed');

        return { instance: renewed, sessionExpiredAndRecreated: false };
      }

      // A failed renewal says nothing about the instance itself. Keep using it
      // while it is still valid and retry on the next call rather than
      // discarding the topic's files and background processes.
      if (this.hasOperationLifetime(cached, operationTimeoutMs)) {
        this.rememberInstance(key, cached);
        return { instance: cached, sessionExpiredAndRecreated: false };
      }

      if (cached.expiresAt > Date.now()) {
        throw new Error(
          'Sandbox renewal failed and the remaining instance lifetime is shorter than the requested operation timeout',
        );
      }

      // The update result is ambiguous: it may have succeeded server-side
      // before its response timed out, or another replica may already have
      // renewed this deterministic conversation. Never release based only on
      // our stale timestamp. Reacquire by ConversationId and let the control
      // plane return the live owner (or create a replacement).
      return this.reacquireExpired(key, cached, operationTimeoutMs, requestedTimeoutSec);
    }

    const previousInstanceId = instanceHistory.get(key);
    const instance = await this.acquire(requestedTimeoutSec);
    this.assertOperationLifetime(instance, operationTimeoutMs, 'acquired');
    this.rememberInstance(key, instance);

    return {
      instance,
      sessionExpiredAndRecreated:
        previousInstanceId !== undefined && instance.instanceId !== previousInstanceId,
    };
  }

  /**
   * Reconciles a locally expired entry with the control-plane owner. A remote
   * replica may have renewed the same conversation, so only an instance-id
   * change proves that files and processes were actually replaced.
   */
  private async reacquireExpired(
    key: string,
    previous: AcquiredInstance,
    operationTimeoutMs: number,
    requestedTimeoutSec: number,
  ): Promise<ResolvedInstance> {
    const instance = await this.acquire(requestedTimeoutSec);
    this.assertOperationLifetime(instance, operationTimeoutMs, 'reacquired');
    this.rememberInstance(key, instance);

    return {
      instance,
      sessionExpiredAndRecreated: instance.instanceId !== previous.instanceId,
    };
  }

  /**
   * Drop expired credentials for inactive sessions while retaining bounded,
   * id-only history so a later acquire can still report a real replacement.
   */
  private compactInstanceCache(currentKey: string) {
    const now = Date.now();

    for (const [key, instance] of instances) {
      if (key !== currentKey && instance.expiresAt <= now) {
        instances.delete(key);
      }
    }
  }

  private rememberInstance(key: string, instance: AcquiredInstance) {
    // Delete before set to make Map insertion order an LRU order.
    instances.delete(key);
    instances.set(key, instance);
    instanceHistory.delete(key);
    instanceHistory.set(key, instance.instanceId);

    this.trimOldest(instances, INSTANCE_CACHE_LIMIT);
    this.trimOldest(instanceHistory, INSTANCE_HISTORY_LIMIT);
  }

  private trimOldest<T>(cache: Map<string, T>, limit: number) {
    while (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) return;

      cache.delete(oldest);
    }
  }

  private requiredLifetimeMs(operationTimeoutMs: number): number {
    return operationTimeoutMs + INSTANCE_OPERATION_HEADROOM_MS;
  }

  private requestedInstanceTimeoutSec(operationTimeoutMs: number): number {
    const requiredTimeoutSec = Math.ceil(this.requiredLifetimeMs(operationTimeoutMs) / 1000);

    if (requiredTimeoutSec > MAX_INSTANCE_TIMEOUT_SEC) {
      throw new Error(
        `timeout must not exceed ${MAX_INSTANCE_OPERATION_TIMEOUT_MS.toLocaleString('en-US')} milliseconds for Tencent sandboxes`,
      );
    }

    return Math.max(this.timeoutSec(), requiredTimeoutSec);
  }

  private hasOperationLifetime(instance: AcquiredInstance, operationTimeoutMs: number): boolean {
    return (
      instance.expiresAt - Date.now() >= operationTimeoutMs + INSTANCE_OPERATION_START_MARGIN_MS
    );
  }

  private hasRequiredLifetime(instance: AcquiredInstance, operationTimeoutMs: number): boolean {
    return instance.expiresAt - Date.now() >= this.requiredLifetimeMs(operationTimeoutMs);
  }

  private assertOperationLifetime(
    instance: AcquiredInstance,
    operationTimeoutMs: number,
    action: string,
  ) {
    if (this.hasOperationLifetime(instance, operationTimeoutMs)) return;

    throw new Error(
      `Sandbox ${action} instance lifetime is shorter than the requested operation timeout`,
    );
  }

  private async renew(
    instance: AcquiredInstance,
    requestedTimeoutSec: number,
  ): Promise<AcquiredInstance | undefined> {
    try {
      const data = await this.request('update', {
        InstanceId: instance.instanceId,
        Timeout: requestedTimeoutSec,
      });

      const expiresAt = this.parseExpirationTime(data.InstanceExpiresAt);
      if (expiresAt === undefined) {
        throw new Error('Sandbox update response missing a valid InstanceExpiresAt');
      }

      // The service may cap a requested extension. Its returned expiry is the
      // authority; locally adding the requested timeout can keep a dead client
      // cached after the backend has already reclaimed it.
      return { ...instance, expiresAt };
    } catch (error) {
      log(
        'Failed to renew instance %s; retaining it until its known expiry: %O',
        instance.instanceId,
        error,
      );

      return undefined;
    }
  }

  private async acquire(requestedTimeoutSec: number): Promise<AcquiredInstance> {
    const data = await this.request('acquire', {
      ConversationId: this.sessionKey(),
      Region: sandboxEnv.TENCENT_SANDBOX_REGION || DEFAULT_REGION,
      Timeout: requestedTimeoutSec,
    });

    return {
      domain: this.requiredString(data, 'SandboxDomain'),
      envdVersion: (data.EnvdVersion as string) || ENVD_FALLBACK_VERSION,
      expiresAt:
        this.parseExpirationTime(data.InstanceExpiresAt) ?? Date.now() + requestedTimeoutSec * 1000,
      instanceId: this.requiredString(data, 'InstanceId'),
      token: this.requiredString(data, 'Token'),
      trafficToken: data.TrafficToken as string | undefined,
    };
  }

  private parseExpirationTime(value: unknown): number | undefined {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;

    return Number.isFinite(parsed) ? parsed : undefined;
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
      signal: AbortSignal.timeout(CONTROL_PLANE_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`Sandbox ${action} failed with status ${response.status}`);

    const body = (await response.json()) as {
      Code?: number;
      Data?: Record<string, unknown>;
      Message?: string;
      message?: string;
    };

    if (body.Code !== 0 || !body.Data) {
      throw new Error(body.Message || body.message || `Sandbox ${action} returned an error`);
    }

    return body.Data;
  }

  private sessionKey(): string {
    // Makers conversation ids are limited to 6–36 characters from a restricted
    // alphabet. Hashing also prevents account/topic identifiers from leaving
    // LobeHub and avoids delimiter collisions.
    const digest = createHmac('sha256', sandboxEnv.TENCENT_SANDBOX_API_TOKEN || '')
      .update(JSON.stringify([this.options.userId, this.options.topicId]))
      .digest('hex');

    return `lobe_${digest.slice(0, 31)}`;
  }

  private timeoutSec(): number {
    return sandboxEnv.TENCENT_SANDBOX_TIMEOUT_SEC || DEFAULT_TIMEOUT_SEC;
  }

  private requiredString(data: Record<string, unknown>, field: string): string {
    const value = data[field];

    if (typeof value !== 'string' || !value) throw new Error(`Sandbox response missing ${field}`);

    return value;
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
  instanceHistory.clear();
  pending.clear();
};
