import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import {
  McpElicitationClient,
  type McpElicitationContinuation,
  type McpElicitationHost,
  McpProtocolClient,
} from '@lobechat/mcp-elicitation';
import type { Client, Progress, Transport } from '@modelcontextprotocol/client';
import {
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { getDesktopEnv } from '@/env';

import { reapOrphanedProcessGroup, terminatePrecheckProcess } from './process-tree';
import type { MCPClientParams, McpPrompt, McpResource, McpTool, ToolCallResult } from './types';

// Process-tree teardown lives in ./process-tree; re-export so existing
// importers of this module (and the focused test file) keep one import path.
export {
  reapOrphanedProcessGroup,
  signalProcessTree,
  terminatePrecheckProcess,
} from './process-tree';

/**
 * The SDK surfaces a stdio process that died without completing the MCP
 * handshake as `SdkError(SdkErrorCode.ConnectionClosed)`. This is
 * the only failure class the diagnostic re-spawn can improve: when the
 * server rejected the handshake for a protocol/configuration reason instead,
 * re-running the same command adds a five-second probe window and a
 * temporary duplicate server process without producing new information.
 */
export function isBareConnectionClosedError(error: unknown): boolean {
  return SdkError.isInstance(error) && error.code === SdkErrorCode.ConnectionClosed;
}

/**
 * Custom error class for MCP connection errors that includes STDIO logs
 */
export class MCPConnectionError extends Error {
  readonly stderrLogs: string[];

  constructor(message: string, stderrLogs: string[] = []) {
    super(message);
    this.name = 'MCPConnectionError';
    this.stderrLogs = stderrLogs;
  }
}

/**
 * Known Windows loader error messages surfaced when a shim/script target path
 * does not exist (reported in the user's locale, e.g. pt-BR
 * "O sistema não pode encontrar o caminho especificado").
 */
const WINDOWS_PATH_NOT_FOUND_PATTERNS = [
  '找不到指定的路径', // zh-CN
  '找不到指定的文件', // zh-CN (file variant)
  'The system cannot find the path specified', // en-US
  'The system cannot find the file specified', // en-US (file variant)
  'não pode encontrar o caminho especificado', // pt-BR
  'no se puede encontrar la ruta especificada', // es-419
  'Das System kann den angegebenen Pfad nicht finden', // de-DE
  '指定されたパスが見つかりません', // ja-JP
  '지정된 경로를 찾을 수 없습니다', // ko-KR
];

export interface StdioSpawnFailureInput {
  args?: string[];
  command: string;
  /** errno for spawn 'error' events (negative on Windows, e.g. -4058) */
  errno?: number;
  exitCode?: number | null;
  message?: string;
  /** Termination signal when the process was killed by one (e.g. SIGTERM) */
  signal?: NodeJS.Signals | null;
  spawnCode?: string | null;
  stderr?: string;
  /** Some launchers report the actual failure (e.g. loader errors) on stdout */
  stdout?: string;
}

/** Per-stream cap for pre-check output so a noisy command cannot balloon the
 * Electron main process heap while the 5s pre-check window runs. */
const PRECHECK_OUTPUT_CAP_BYTES = 64 * 1024;

/** Grace window between `exit` and `close` before the pre-check classifies
 * on the data captured so far — a grandchild holding the stdio pipes can
 * keep `close` pending indefinitely (see the `close`/`exit` handlers in
 * `preCheckStdioCommand`). */
const PRECHECK_CLOSE_GRACE_MS = 750;

/**
 * Find the first index at or after `start` that begins a complete UTF-8
 * sequence, skipping the continuation bytes of a character split by the cut.
 * Advances at most 3 bytes; returns `start` when it already lands on a
 * sequence boundary.
 */
const utf8SequenceStart = (buf: Buffer, start: number): number => {
  let index = start;
  while (index < buf.byteLength && (buf[index] & 0b1100_0000) === 0b1000_0000) index += 1;
  return index;
};

/**
 * Per-stream pre-check output accumulator (bounded tail buffer).
 *
 * Keeps the most recent bytes under a hard per-stream cap so a noisy launcher
 * cannot balloon the Electron main-process heap, while the stream's actual
 * tail — where launchers print the decisive startup error — stays available
 * for diagnosis. The previous prefix-accumulate-then-drop design kept only
 * the first 64 KiB, so the tail-10 line selection saw the tail of that prefix
 * and lost errors printed after the cap (P2 4306325895).
 *
 * Raw bytes are buffered and decoded as a whole on flush: stream chunks do
 * not preserve character boundaries, and decoding each chunk independently
 * turns a multibyte character split across two chunks into U+FFFD — which
 * broke localized (e.g. pt-BR) path-not-found matchers (P2 4306581051).
 */
export class PrecheckOutputStream {
  private readonly label: 'stdout' | 'stderr';
  private tail: Buffer = Buffer.alloc(0);
  private overflown = false;

  constructor(label: 'stdout' | 'stderr') {
    this.label = label;
  }

  /** Buffer a raw stdout/stderr chunk; retains only the most recent cap bytes. */
  append(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;

    if (chunk.byteLength >= PRECHECK_OUTPUT_CAP_BYTES) {
      // Single oversized chunk: keep its last cap bytes on a sequence boundary.
      this.tail = chunk.subarray(
        utf8SequenceStart(chunk, chunk.byteLength - PRECHECK_OUTPUT_CAP_BYTES),
      );
      this.overflown = true;
      return;
    }

    const merged = this.tail.byteLength === 0 ? chunk : Buffer.concat([this.tail, chunk]);
    if (merged.byteLength > PRECHECK_OUTPUT_CAP_BYTES) {
      this.tail = merged.subarray(
        utf8SequenceStart(merged, merged.byteLength - PRECHECK_OUTPUT_CAP_BYTES),
      );
      this.overflown = true;
    } else {
      this.tail = merged;
    }
  }

  /** Whether the stream ever exceeded the per-stream cap. */
  get truncated(): boolean {
    return this.overflown;
  }

  /**
   * Decode the retained tail (pure — safe to call repeatedly). When the cap
   * was hit, the truncation marker is prepended so downstream line selection
   * keeps the decisive error while still disclosing the truncation.
   */
  toString(): string {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(this.tail);
    if (!this.overflown) return text;
    return `[${this.label} truncated: pre-check output cap reached]\n${text}`;
  }
}

/**
 * Select diagnostic lines for the MCPConnectionError payload. Keeps the TAIL
 * of each stream: launchers print startup chatter first and emit the decisive
 * error last, so head-slicing keeps the noise and drops the lines that
 * actually explain the failure. Both streams are capped upstream (64 KiB), so
 * the result stays small.
 *
 * The truncation notice emitted by PrecheckOutputStream.toString() is
 * prepended to the stream text BEFORE the payload, so it must be pulled out
 * before tail-slicing — otherwise a stream with ≥ 10 retained lines silently
 * drops the notice and the tail looks complete even though earlier output was
 * discarded (P2 4307065883).
 */
const truncationNoticePattern = /^\[(?:stdout|stderr) truncated: pre-check output cap reached\]$/;

export function selectDiagnosticOutputLines(stdout: string, stderr: string): string[] {
  const tailLines = (text: string) => {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const notices: string[] = [];
    const payload: string[] = [];
    for (const line of lines) {
      if (truncationNoticePattern.test(line)) notices.push(line);
      else payload.push(line);
    }
    return [...notices, ...payload.slice(-10)];
  };
  return [...tailLines(stdout), ...tailLines(stderr)];
}

/** Build the minimal JSON-RPC initialize probe sent to the pre-check child. */
export function buildInitializeProbeMessage(): string {
  return (
    JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'lobe-mcp-precheck', version: '1.0.0' },
        protocolVersion: '2024-11-05',
      },
    }) + '\n'
  );
}

/**
 * Detect the JSON-RPC response to the initialize probe (id: 1) in captured
 * pre-check stdout. Exit status 0 alone does not prove the MCP handshake
 * progressed: one-shot executables and wrappers can start, print an error and
 * exit 0 without ever completing the handshake. Without this check such
 * servers pass the pre-check and the original bare "Connection closed" error
 * surfaces unchanged.
 */
export function hasInitializeResponse(stdout: string): boolean {
  return stdout.split('\n').some((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(trimmed) as { id?: unknown; result?: unknown };
      return parsed.id === 1 && parsed.result !== undefined;
      // Non-JSON lines are startup chatter, not handshake responses.
    } catch {
      return false;
    }
  });
}

/**
 * Build a user-actionable diagnosis for a failed stdio MCP process spawn.
 * Pure function (no I/O) so it can be unit-tested in isolation.
 *
 * Real-world shape (vent msg_PjF7YECkH0nA67ddyY): five Kali MCP connectors on a
 * Windows host all fail with "MCP error -32000: Connection closed" plus the
 * loader message "O sistema não pode encontrar o caminho especificado" — the
 * SDK spawns with `shell: false`, so the configured command/its shim must
 * resolve to a real executable; a broken install or a stale PATH surfaces as
 * an immediate process exit with that stderr, and previously users only saw
 * the bare -32000 with nothing actionable.
 */
export function describeStdioSpawnFailure(input: StdioSpawnFailureInput): string {
  const { command } = input;
  // Launchers may print the real error on stdout instead of stderr — scan both
  const stderr = (input.stderr || '').trim();
  const stdout = (input.stdout || '').trim();
  const combinedOutput = `${stdout}\n${stderr}`.trim();
  const spawnCode = input.spawnCode || null;
  const errno = typeof input.errno === 'number' ? input.errno : undefined;

  // Windows spawns can fail with a numeric errno and no symbolic code
  const codeIsNotFound = spawnCode === 'ENOENT' || errno === -4058 || errno === 4058;
  const codeIsPermission = spawnCode === 'EACCES' || spawnCode === 'EPERM';

  if (codeIsNotFound) {
    return (
      `MCP server executable not found: "${command}". ` +
      'Verify the command exists on this machine (check the configured PATH) and install the package it needs ' +
      '(e.g. `npm install -g <package>` or `pip install <package>`). ' +
      'On Windows, `npx`/`.cmd` shims cannot be spawned directly — configure the real executable instead ' +
      '(e.g. `node <path>\\server.js` or `<path>\\python.exe -m <module>`).'
    );
  }

  if (codeIsPermission) {
    return (
      `MCP server executable is not executable: "${command}". ` +
      'Check file permissions (on macOS/Linux: `chmod +x <file>`) or antivirus/security-software blocks.'
    );
  }

  const windowsPathNotFound = WINDOWS_PATH_NOT_FOUND_PATTERNS.some((pattern) =>
    combinedOutput.toLowerCase().includes(pattern.toLowerCase()),
  );

  if (windowsPathNotFound) {
    return (
      `MCP server "${command}" failed to start: the loader reported "path not found" (see the process output below). ` +
      'The configured command or one of its script/shim targets does not exist on this machine. ' +
      'Reinstall the MCP server package, or fix the configured command/args to point at an existing executable. ' +
      'On Windows, `npx`/`.cmd` shims require the target script to exist — prefer the real executable path.'
    );
  }

  // Signal-only kills have exitCode === null in Node; surface the crash
  // signal instead of the generic "check PATH / install" advice. Catch it
  // before the exitCode branch, which the null code would skip.
  if (input.signal) {
    return (
      `MCP server "${command}" crashed: terminated by signal ${input.signal}` +
      `${combinedOutput ? ' (see the process output below)' : ' with no output'}. ` +
      'This usually indicates an unhandled native-level failure (e.g. missing shared library or corrupted binary); ' +
      'reinstall the MCP server package and verify it runs standalone.'
    );
  }

  // Zero-code exits are only passed by the pre-check when the process
  // terminated cleanly WITHOUT completing the MCP handshake — a persistent
  // MCP server must stay alive and answer initialize requests. Catch before
  // the exitCode branch, which skips code 0.
  if (input.exitCode === 0) {
    return (
      `MCP server "${command}" exited (code 0) without completing the MCP handshake. ` +
      'A persistent MCP server must stay running and respond to initialize requests; ' +
      'the configured command may be a one-shot utility, or it may be exiting right ' +
      'after startup (see the process output below for any error it printed).'
    );
  }

  if (input.exitCode !== undefined && input.exitCode !== null && input.exitCode !== 0) {
    return (
      `MCP server "${command}" exited immediately with code ${input.exitCode}` +
      `${input.signal ? ` (signal ${input.signal})` : ''}` +
      ". Check the process output below and the server's installation requirements."
    );
  }

  if (stderr) {
    return `MCP server "${command}" failed to start. Check the process output below.`;
  }

  return (
    `MCP server "${command}" failed to start and produced no output. ` +
    'Verify the command exists on this machine (check the configured PATH) and install the package it needs ' +
    '(e.g. `npm install -g <package>` or `pip install <package>`).'
  );
}

export class MCPClient {
  /**
   * Upper bound on retained stderr lines. Pooled clients can live for the
   * whole desktop session; without a cap a verbose long-lived MCP server
   * would grow `stderrLogs` (and every enhanced error built from it)
   * without limit. Only the most recent tail is kept for diagnostics.
   */
  private static readonly STDERR_LOG_LIMIT = 200;

  private readonly mcp: Client;
  private readonly elicitation: McpElicitationClient;

  private transport: Transport;
  private stderrLogs: string[] = [];
  private isStdio: boolean = false;
  /**
   * Kept for post-failure diagnostics: `StdioClientTransport` does not expose
   * its server params, and re-spawning the command after a bare
   * "Connection closed" is the only way to surface an actionable error.
   */
  private stdioParams?: { args?: string[]; command: string; env?: Record<string, string> };

  constructor(params: MCPClientParams, elicitationEnabled = false) {
    this.mcp = new McpProtocolClient(
      { name: 'lobehub-desktop-mcp-client', version: '1.0.0' },
      {
        // Do not add a probe subprocess/timeout to stdio installations or calls.
        versionNegotiation: { mode: params.type === 'http' ? 'auto' : 'legacy' },
        inputRequired: { autoFulfill: false },
      },
    );

    this.elicitation = new McpElicitationClient(this.mcp, elicitationEnabled, () =>
      this.disconnect(),
    );

    switch (params.type) {
      case 'http': {
        const headers: Record<string, string> = { ...params.headers };

        if (params.auth) {
          if (params.auth.type === 'bearer' && params.auth.token) {
            headers['Authorization'] = `Bearer ${params.auth.token}`;
          }

          if (params.auth.type === 'oauth2' && params.auth.accessToken) {
            headers['Authorization'] = `Bearer ${params.auth.accessToken}`;
          }
        }

        this.transport = new StreamableHTTPClientTransport(new URL(params.url), {
          requestInit: { headers },
        });
        break;
      }

      case 'stdio': {
        this.isStdio = true;
        this.stdioParams = {
          args: params.args,
          command: params.command,
          env: params.env,
        };
        const stdioTransport = new StdioClientTransport({
          args: params.args,
          command: params.command,
          env: {
            ...getDefaultEnvironment(),
            ...params.env,
          },
          stderr: 'pipe', // Capture stderr for better error messages
        });

        // Listen to stderr stream to collect logs
        this.setupStderrListener(stdioTransport);

        this.transport = stdioTransport;
        break;
      }

      default: {
        // Exhaustive check

        const _never: never = params;
        throw new Error(`Unsupported MCP connection type: ${(params as any).type}`);
      }
    }
  }

  private setupStderrListener(transport: StdioClientTransport) {
    const stderr = transport.stderr as Readable | null;
    if (stderr) {
      stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        // Split by newlines and filter empty lines
        const lines = text.split('\n').filter((line) => line.trim());
        this.stderrLogs.push(...lines);
        // Keep only the most recent tail: a pooled, long-lived stdio
        // server must not grow desktop memory without bound.
        if (this.stderrLogs.length > MCPClient.STDERR_LOG_LIMIT) {
          this.stderrLogs.splice(0, this.stderrLogs.length - MCPClient.STDERR_LOG_LIMIT);
        }
      });
    }
  }

  /**
   * Get collected stderr logs from the STDIO process
   */
  getStderrLogs(): string[] {
    return this.stderrLogs;
  }

  /**
   * Re-run the stdio command out-of-band to capture the concrete startup
   * failure. `StdioClientTransport.start()` rejects with the bare transport
   * error ("Connection closed", SDK error -32000) and when the process dies
   * instantly there is often no stderr flowing through the transport's pipe
   * yet — leaving users with nothing actionable. Mirrors the web app's
   * `preCheckStdioCommand` (src/libs/mcp/client.ts).
   */
  private preCheckStdioCommand(params: {
    args?: string[];
    command: string;
    env?: Record<string, string>;
    /** Test hook only — production always uses the default 5s window. */
    timeoutMs?: number;
  }): Promise<{ diagnosis: string; stderr: string; stdout: string; success: boolean }> {
    return new Promise((resolve) => {
      // Do NOT spread the full process.env here: only the SDK's safe defaults
      // plus user-configured vars, matching the main StdioClientTransport.
      const env = {
        ...getDefaultEnvironment(),
        ...params.env,
      } as NodeJS.ProcessEnv;

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(params.command, params.args ?? [], {
          // POSIX only: make the child a process-group leader so teardown
          // can signal the whole tree (launchers that spawn persistent
          // workers leave no orphans). On Windows `detached` means a new
          // console window / DETACHED_PROCESS — not wanted here; tree
          // teardown there is handled via `taskkill /T` (see
          // `signalProcessTree`).
          detached: process.platform !== 'win32',
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        // spawn() can throw synchronously (e.g. invalid args) — normalize it
        const err = error as NodeJS.ErrnoException;
        resolve({
          diagnosis: describeStdioSpawnFailure({
            command: params.command,
            errno: err.errno,
            message: err.message,
            spawnCode: err.code,
          }),
          stderr: '',
          stdout: '',
          success: false,
        });
        return;
      }

      const stdout = new PrecheckOutputStream('stdout');
      const stderr = new PrecheckOutputStream('stderr');
      let resolved = false;

      const finish = (result: {
        diagnosis: string;
        stderr: string;
        stdout: string;
        success: boolean;
      }) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(result);
        }
      };

      // Give the process a short window to either complete the MCP handshake
      // (exit 0 in pre-check terms) or fail with a diagnosable error.
      const timeout = setTimeout(() => {
        if (resolved) return;
        child.stdout?.pause();
        child.stderr?.pause();
        child.stdin?.end();
        // Wait for the confirmed teardown (SIGTERM → SIGKILL escalation →
        // exit event) before resolving; a server that ignores SIGTERM must
        // not survive the pre-check with its pipe listeners attached.
        terminatePrecheckProcess(child, () => {
          // Still running after 5s: treat as healthy-enough; the original
          // connection error is the real failure and should surface as-is.
          finish({
            diagnosis: '',
            stderr: stderr.toString(),
            stdout: stdout.toString(),
            success: true,
          });
        });
      }, params.timeoutMs ?? 5000);

      // P1: the diagnostic child may die instantly (the exact scenario this
      // pre-check targets) and `stdin.write` would emit an async EPIPE that
      // the surrounding try/catch cannot catch — an uncaught exception in the
      // Electron main process. Swallow it; 'error'/'exit' handlers own the
      // failure diagnosis.
      child.stdin?.on('error', () => {});

      child.stdout?.on('data', (data: Buffer) => {
        stdout.append(data);
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr.append(data);
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish({
          diagnosis: describeStdioSpawnFailure({
            command: params.command,
            errno: error.errno,
            message: error.message,
            spawnCode: error.code,
          }),
          stderr: stderr.toString(),
          stdout: stdout.toString(),
          success: false,
        });
      });

      // Classify on `close`, not `exit`: Node emits `exit` when the process
      // terminates but stdio streams may still hold buffered data, so a final
      // loader error — or the initialize response checked by
      // `hasInitializeResponse()` — can arrive after `exit` and be missed,
      // producing a generic or wrong diagnosis. `close` fires only after ALL
      // stdio streams have closed and drained. The `error` handler above
      // still owns spawn failures (error and close are mutually exclusive).
      const classify = (code: number | null, signal: NodeJS.Signals | null) => {
        // The direct child exited on its own. If it was a launcher, its
        // worker descendants may still be alive in the process group —
        // every failed reconnect would otherwise accumulate another
        // orphaned MCP server. Background-reap the group (no-op when the
        // tree already exited; setsid daemons that left the group are
        // untouched). The timeout path instead goes through
        // `terminatePrecheckProcess`, which signals the whole tree itself.
        if (child.pid !== undefined) {
          reapOrphanedProcessGroup(child.pid);
        }

        if (code === 0) {
          // Exit 0 alone does not prove the MCP handshake completed: one-shot
          // executables and wrappers can start, print an error and exit
          // cleanly before responding to the initialize probe. Only credit
          // the probe when an initialize response was actually received;
          // otherwise diagnose the zero-code exit as a startup failure.
          if (hasInitializeResponse(stdout.toString())) {
            finish({
              diagnosis: '',
              stderr: stderr.toString(),
              stdout: stdout.toString(),
              success: true,
            });
          } else {
            finish({
              diagnosis: describeStdioSpawnFailure({
                command: params.command,
                exitCode: 0,
                stderr: stderr.toString(),
                stdout: stdout.toString(),
              }),
              stderr: stderr.toString(),
              success: false,
              stdout: stdout.toString(),
            });
          }
          return;
        }

        finish({
          diagnosis: describeStdioSpawnFailure({
            command: params.command,
            exitCode: code,
            signal,
            stderr: stderr.toString(),
            stdout: stdout.toString(),
          }),
          stderr: stderr.toString(),
          stdout: stdout.toString(),
          success: false,
        });
      };

      // A grandchild spawned by the server can inherit the stdio pipes and
      // keep `close` pending long after the direct child exited. Arm a
      // bounded fallback on `exit` (never before — a healthy long-running
      // server has no exit yet) so a zero-code exit still gets classified
      // with the direct child's real exit code instead of waiting for the
      // 5s timeout and being misclassified as "healthy-enough" — which
      // would regress the round-4 fix that diagnoses one-shot wrappers.
      // When the pipes close in time the `close` handler wins and this
      // timer is cleared.
      let closeFallback: ReturnType<typeof setTimeout> | null = null;

      child.on('close', (code, signal) => {
        if (closeFallback) clearTimeout(closeFallback);
        classify(code, signal);
      });

      child.on('exit', (code, signal) => {
        if (resolved) return;
        closeFallback = setTimeout(() => {
          classify(code, signal);
        }, PRECHECK_CLOSE_GRACE_MS);
      });

      // Send a minimal JSON-RPC initialize so servers that start fine but
      // exit on EOF don't get killed as "failed" before they can boot.
      // `capabilities: {}` is included per the MCP initialize spec so servers
      // that validate params don't reject the probe for a probe-specific
      // reason and mask the real startup failure.
      try {
        child.stdin?.write(buildInitializeProbeMessage());
        child.stdin?.end();
      } catch {
        // stdin write failures are handled via 'error'/'close' events
      }
    });
  }

  private isMethodNotFoundError(error: unknown) {
    return ProtocolError.isInstance(error) && error.code === ProtocolErrorCode.MethodNotFound;
  }

  async initialize(options: { onProgress?: (progress: Progress) => void } = {}) {
    try {
      await this.mcp.connect(this.transport, { onprogress: options.onProgress });
    } catch (error) {
      // If this is a STDIO connection and we have stderr logs, enhance the error
      if (this.isStdio && this.stderrLogs.length > 0) {
        const originalMessage = error instanceof Error ? error.message : String(error);
        throw new MCPConnectionError(originalMessage, this.stderrLogs);
      }

      // When the process dies instantly there may be no stderr at all, leaving
      // users with a bare "Connection closed" (-32000). Re-spawn once to
      // capture a concrete, actionable diagnosis instead. Other failure
      // classes (protocol/configuration errors with stderr already flowing
      // through the transport) gain nothing from a re-spawn: the probe can
      // only diagnose startup liveness, so gate it to the bare
      // connection-closed failure (P2 4306033474).
      if (this.isStdio && this.stdioParams?.command && isBareConnectionClosedError(error)) {
        const preCheck = await this.preCheckStdioCommand({
          args: this.stdioParams.args,
          command: this.stdioParams.command,
          env: this.stdioParams.env,
        });

        if (!preCheck.success) {
          const originalMessage = error instanceof Error ? error.message : String(error);
          // Bounded process output (stdout can carry the real launcher error
          // when the process writes nothing to stderr). Merge both streams,
          // keeping the tail of each — the decisive error is usually the last
          // line, after startup chatter. selectDiagnosticOutputLines caps the
          // result (10 lines per stream; both streams are capped at 64 KiB).
          const outputLines = selectDiagnosticOutputLines(preCheck.stdout, preCheck.stderr);

          throw new MCPConnectionError(
            `${preCheck.diagnosis} (original error: ${originalMessage})`,
            outputLines,
          );
        }
      }

      throw error;
    }
  }

  async disconnect() {
    await this.mcp.close();
  }

  getProtocolEra() {
    return this.mcp.getProtocolEra();
  }

  async listTools() {
    const { tools } = await this.mcp.listTools();
    return (tools || []) as McpTool[];
  }

  async listResources() {
    const { resources } = await this.mcp.listResources();
    return (resources || []) as McpResource[];
  }

  async listPrompts() {
    const { prompts } = await this.mcp.listPrompts();
    return (prompts || []) as McpPrompt[];
  }

  async listManifests() {
    const [tools, prompts, resources] = await Promise.all([
      this.listTools(),
      this.listPrompts().catch((error) => {
        if (this.isMethodNotFoundError(error)) return [] as McpPrompt[];
        throw error;
      }),
      this.listResources().catch((error) => {
        if (this.isMethodNotFoundError(error)) return [] as McpResource[];
        throw error;
      }),
    ]);

    return {
      prompts: prompts.length === 0 ? undefined : prompts,
      resources: resources.length === 0 ? undefined : resources,
      title: this.mcp.getServerVersion()?.title,
      tools: tools.length === 0 ? undefined : tools,
      version: this.mcp.getServerVersion()?.version?.replace('v', ''),
    };
  }

  async callTool(
    toolName: string,
    args: any,
    options: {
      host?: McpElicitationHost;
      continuation?: McpElicitationContinuation;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<ToolCallResult> {
    const invoke = options.host
      ? () =>
          this.elicitation.callToolInteractively(
            { arguments: args, name: toolName },
            {
              timeout: options.timeoutMs ?? getDesktopEnv().MCP_TOOL_TIMEOUT,
              signal: options.signal,
            },
            options.host!,
          )
      : () =>
          this.elicitation.callTool(
            { arguments: args, name: toolName },
            {
              timeout: options.timeoutMs ?? getDesktopEnv().MCP_TOOL_TIMEOUT,
              signal: options.signal,
            },
            options.host,
            options.continuation,
          );
    const result = await invoke();
    return result as ToolCallResult;
  }
}
