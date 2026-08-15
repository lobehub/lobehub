import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import {
  PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS,
  PI_RPC_HANDSHAKE_TIMEOUT_MS,
  type PiExtensionUiRequest,
  type PiExtensionUiResponse,
  type PiRpcCommand,
  type PiRpcEvent,
  type PiRpcResponse,
} from './piRpcProtocol';

/** Error thrown when a pi RPC command fails (`success: false` response). */
export class PiRpcResponseError extends Error {
  constructor(
    readonly command: string,
    readonly rpcError: string,
  ) {
    super(`Pi RPC command failed (${command}): ${rpcError}`);
    this.name = 'PiRpcResponseError';
  }
}

/** Error thrown when the pi process dies or the connection breaks. */
export class PiRpcConnectionError extends Error {
  constructor(
    message: string,
    readonly options?: { phase?: 'spawn' | 'handshake' | 'run'; stderr?: string },
  ) {
    super(message);
    this.name = 'PiRpcConnectionError';
  }
}

interface PendingCommand {
  command: string;
  reject: (error: Error) => void;
  resolve: (response: PiRpcResponse) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export interface PiRpcClientOptions {
  /** Extra CLI args after `--mode rpc` (e.g. `--session-id <id>`, `--provider`). */
  args: string[];
  /** Absolute (or resolved) path to the `pi` executable. */
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /**
   * Invoked for every parsed agent event from stdout. Events never carry an
   * `id`; the host correlates them to the active run itself.
   */
  onEvent: (event: PiRpcEvent) => void | Promise<void>;
  /**
   * Invoked for extension UI requests. Dialog methods (`select` / `confirm` /
   * `input` / `editor`) block until the returned response (or the request's
   * own `timeout`) is delivered. When the host returns `undefined` or omits
   * the handler, dialogs are cancelled (`cancelled: true`) so a run never
   * hangs on an unrenderable prompt. Fire-and-forget methods are surfaced
   * here too but never answered.
   */
  onExtensionUiRequest?: (
    request: PiExtensionUiRequest,
  ) => Promise<PiExtensionUiResponse | undefined> | PiExtensionUiResponse | undefined;
  onStderr: (data: string) => void | Promise<void>;
  /** Default response timeout per command. `false` disables the timeout. */
  requestTimeoutMs?: number | false;
  /** How long to wait for a clean exit after `stdin.end()` before escalating. */
  closeGraceMs?: number;
  /** Startup handshake timeout (`get_state`). */
  handshakeTimeoutMs?: number;
}

const DEFAULT_CLOSE_GRACE_MS = 3_000;
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Persistent JSONL client for `pi --mode rpc`.
 *
 * Spawns pi as a long-lived child with stdin kept open, writes commands as
 * JSONL, and correlates responses by `id`. Agent events stream to `onEvent`;
 * the extension UI sub-protocol is answered through `onExtensionUiRequest`
 * (dialogs) or surfaced and ignored (fire-and-forget).
 *
 * Closing is graceful-first: `stdin.end()` (EOF) makes pi dispose its runtime
 * and exit 0. Only when the process fails to exit within `closeGraceMs` does
 * the client escalate to SIGTERM then SIGKILL, so a normal session end never
 * orphans tool subprocesses the way a signal kill can.
 */
export class PiRpcClient {
  private readonly pendingCommands = new Map<string, PendingCommand>();
  private child?: ChildProcess;
  private closed = false;
  private closePromise?: Promise<void>;
  private fatalError?: Error;
  private messageQueue: Promise<void> = Promise.resolve();
  private nextCommandId = 0;
  private stdoutBuffer = '';
  private handshakeResolved = false;

  constructor(private readonly options: PiRpcClientOptions) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** True once the startup handshake succeeded (`get_state` answered). */
  get isReady(): boolean {
    return this.handshakeResolved && !this.closed;
  }

  /**
   * Spawn the process and complete the startup handshake. Rejects with a
   * `PiRpcConnectionError` when pi cannot start or does not answer
   * `get_state` within {@link PI_RPC_HANDSHAKE_TIMEOUT_MS} — the hard-fail
   * guarantee: an unsupported / broken pi install surfaces as a clear error
   * instead of a silent hang.
   */
  async start(): Promise<void> {
    if (this.child || this.closed) return;

    const spawnPlan = await resolveCliSpawnPlan(this.options.commandPath, [
      '--mode',
      'rpc',
      ...this.options.args,
    ]);
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32',
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdin?.once('error', (error) => {
      if (!this.closed) this.fail(error);
    });
    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    child.stdout?.once('end', () => this.consumeRemainingStdout());
    child.stdout?.once('error', (error) => this.fail(error));
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrChunks.push(chunk.toString('utf8'));
      void Promise.resolve()
        .then(() => {
          if (!this.closed) return this.options.onStderr(chunk.toString('utf8'));
        })
        .catch((error) => this.fail(this.toError(error)));
    });
    child.once('error', (error) => {
      this.fail(new PiRpcConnectionError(`Failed to start pi RPC: ${error.message}`, { phase: 'spawn' }));
    });
    child.once('close', (code, signal) => {
      if (this.closed) return;
      const stderr = this.stderrText;
      const error = new PiRpcConnectionError(
        `pi RPC exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
        { phase: this.handshakeResolved ? 'run' : 'handshake', stderr },
      );
      this.messageQueue = this.messageQueue.then(() => this.fail(error));
    });

    await this.performHandshake();
  }

  /**
   * Send a command and await its response. Rejects on `success: false`,
   * timeout, or connection failure. Note: for `prompt`, pi answers as soon as
   * the message is accepted/queued — the run's outcome arrives as events.
   */
  async command<T = any>(command: PiRpcCommand, timeoutMs?: number | false): Promise<PiRpcResponse<T>> {
    if (this.fatalError) throw this.fatalError;
    if (this.closed) throw new PiRpcConnectionError('pi RPC client is closed');
    if (!this.child?.stdin) throw new PiRpcConnectionError('pi RPC stdin is unavailable');

    const id = String(++this.nextCommandId);
    return new Promise<PiRpcResponse<T>>((resolve, reject) => {
      const pending: PendingCommand = {
        command: command.type,
        reject,
        resolve: (response) => resolve(response as PiRpcResponse<T>),
      };
      const timeout = timeoutMs ?? this.options.requestTimeoutMs ?? PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS;
      if (timeout !== false) {
        pending.timeout = setTimeout(() => {
          this.pendingCommands.delete(id);
          reject(
            new PiRpcConnectionError(`pi RPC command timed out: ${command.type}`, {
              phase: 'run',
            }),
          );
        }, timeout);
        pending.timeout.unref?.();
      }
      this.pendingCommands.set(id, pending);
      try {
        this.writeCommand({ ...command, id });
      } catch (error) {
        if (this.pendingCommands.get(id) === pending) this.pendingCommands.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
        reject(this.toError(error));
      }
    });
  }

  /**
   * Graceful close: send EOF, wait for pi to exit, escalate only if needed.
   * Resolves when the child is gone (or was never spawned).
   */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.closePromise ??= this.shutdown();
    return this.closePromise;
  }

  /** Send `abort` without resolving the close lifecycle. */
  async abort(): Promise<void> {
    try {
      await this.command({ type: 'abort' }, false);
    } catch (error) {
      if (error instanceof PiRpcResponseError) throw error;
      // Connection already broken — the run is over either way.
    }
  }

  private async performHandshake(): Promise<void> {
    // No command-level timeout on the handshake — the watchdog below owns it
    // so the failure message is deterministic.
    const handshake = this.command<{ sessionId?: string; sessionFile?: string }>(
      { type: 'get_state' },
      false,
    );
    const timeout = setTimeout(() => {
      void handshake.catch(() => {
        /* settle — the rejection below wins */
      });
      this.fail(
        new PiRpcConnectionError(
          'pi did not answer the RPC handshake (get_state) — upgrade pi or check the install',
          { phase: 'handshake' },
        ),
      );
    }, this.options.handshakeTimeoutMs ?? PI_RPC_HANDSHAKE_TIMEOUT_MS);
    timeout.unref?.();

    try {
      const response = await handshake;
      clearTimeout(timeout);
      if (!response.success) {
        throw new PiRpcConnectionError(
          `pi RPC handshake failed: ${response.error ?? 'get_state returned success: false'}`,
          { phase: 'handshake', stderr: this.stderrText },
        );
      }
      this.handshakeResolved = true;
    } catch (error) {
      clearTimeout(timeout);
      if (!this.closed && !this.fatalError) this.fail(this.toError(error));
      throw error;
    }
  }

  private async shutdown(): Promise<void> {
    const child = this.child;
    if (!child?.stdin) return;

    const exitPromise = new Promise<void>((resolve) => {
      const onClose = () => resolve();
      child.once('close', onClose);
      setTimeout(() => {
        child.off('close', onClose);
        resolve();
      }, this.options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS).unref?.();
    });

    try {
      child.stdin.end();
    } catch {
      // stdin already broken — fall through to signal escalation.
    }
    await exitPromise;

    if (!child.killed && child.exitCode === null && child.signalCode === null) {
      this.terminateChild(child, 'SIGTERM');
      setTimeout(() => {
        if (!child.killed && child.exitCode === null && child.signalCode === null) {
          this.terminateChild(child, 'SIGKILL');
        }
      }, 2_000).unref?.();
    }
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.closed) return;
    this.stdoutBuffer += chunk.toString('utf8');

    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.enqueueLine(line);
    }
  }

  private consumeRemainingStdout(): void {
    if (this.closed) {
      this.stdoutBuffer = '';
      return;
    }
    if (!this.stdoutBuffer) return;
    const line = this.stdoutBuffer;
    this.stdoutBuffer = '';
    this.enqueueLine(line);
  }

  private enqueueLine(rawLine: string): void {
    if (this.closed) return;
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return;

    this.messageQueue = this.messageQueue
      .then(() => this.handleLine(line))
      .catch((error) => this.fail(this.toError(error)));
  }

  private async handleLine(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      // One non-JSON diagnostic line must not corrupt framing.
      return;
    }
    if (!isRecord(message)) return;

    if (message.type === 'response') {
      this.handleResponse(message as unknown as PiRpcResponse);
      return;
    }
    if (message.type === 'extension_ui_request') {
      await this.handleExtensionUiRequest(message as unknown as PiExtensionUiRequest);
      return;
    }
    // Everything else is an agent event.
    await this.options.onEvent(message as PiRpcEvent);
  }

  private handleResponse(response: PiRpcResponse): void {
    const key = response.id;
    if (key === undefined) return;
    const pending = this.pendingCommands.get(String(key));
    if (!pending) return;

    this.pendingCommands.delete(String(key));
    if (pending.timeout) clearTimeout(pending.timeout);

    if (response.success) pending.resolve(response);
    else pending.reject(new PiRpcResponseError(pending.command, response.error ?? 'Unknown error'));
  }

  private async handleExtensionUiRequest(request: PiExtensionUiRequest): Promise<void> {
    const method = request.method;
    if (!DIALOG_METHODS.has(method)) {
      // Fire-and-forget — surface to the host, never answer.
      await this.options.onExtensionUiRequest?.(request);
      return;
    }

    let response: PiExtensionUiResponse | undefined;
    try {
      response = await this.options.onExtensionUiRequest?.(request);
    } catch {
      response = undefined;
    }
    // No host handler (or it declined) → cancel so the extension unblocks.
    this.writeCommand(
      (response ?? { cancelled: true, id: request.id, type: 'extension_ui_response' }) as Record<
        string,
        unknown
      >,
    );
  }

  private writeCommand(command: Record<string, unknown>): void {
    if (!this.child?.stdin || this.closed) {
      throw new PiRpcConnectionError('pi RPC stdin is unavailable');
    }
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.fatalError ??= error;
    this.rejectPendingCommands(error);
  }

  private rejectPendingCommands(error: Error): void {
    for (const [, pending] of this.pendingCommands) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingCommands.clear();
  }

  private terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid || child.killed) return;

    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
      return;
    }

    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }

  private get stderrText(): string {
    return this.stderrChunks.join('');
  }

  private readonly stderrChunks: string[] = [];

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
