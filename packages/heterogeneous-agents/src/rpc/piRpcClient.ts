import { execFile } from 'node:child_process';

import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import { PiOperationContextUnavailableError, PiRpcOperationContext } from './piRpcOperationContext';
import {
  PI_RPC_ABORT_TIMEOUT_MS,
  PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS,
  PI_RPC_HANDSHAKE_TIMEOUT_MS,
  PI_RPC_MIN_CLI_VERSION,
  type PiExtensionUiRequest,
  type PiExtensionUiResponse,
  type PiRpcCommand,
  type PiRpcEvent,
  type PiRpcResponse,
} from './piRpcProtocol';
import { RpcStdioClient, RpcStdioConnectionError } from './rpcStdioClient';

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

export interface PiRpcClientOptions {
  /** Extra CLI args after `--mode rpc` (e.g. `--session-id <id>`, `--provider`). */
  args: string[];
  /** How long to wait for a clean exit after `stdin.end()` before escalating. */
  closeGraceMs?: number;
  /** Absolute (or resolved) path to the `pi` executable. */
  commandPath: string;
  cwd: string;
  detached?: boolean;
  env: NodeJS.ProcessEnv;
  /** Startup handshake timeout (`get_state`). */
  handshakeTimeoutMs?: number;
  onError?: (error: PiRpcConnectionError) => void;
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
  onRawStdout?: (chunk: Buffer) => void;
  onStderr: (data: string) => void | Promise<void>;
  /** Enable the private per-turn env bridge for a pooled process. */
  operationContext?: boolean;
  /** Default response timeout per command. `false` disables the timeout. */
  requestTimeoutMs?: number | false;
}

const DEFAULT_CLOSE_GRACE_MS = 3_000;
const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

/**
 * Protocol layer for `pi --mode rpc`, built on the generic
 * {@link RpcStdioClient} transport.
 *
 * Adds the pi wire schema to the transport: commands are `{ type, … }`
 * payloads answered by `{ type: 'response', command, success, … }` records
 * (a `success: false` response rejects with `PiRpcResponseError`), agent
 * events and the extension UI sub-protocol flow through `onMessage`, and a
 * `get_state` handshake hard-fails when pi is missing or too old to speak
 * RPC. Closing is graceful-first (EOF → SIGTERM → SIGKILL).
 */
export class PiRpcClient {
  private readonly transport: RpcStdioClient;
  private readonly options: PiRpcClientOptions;
  private handshakeResolved = false;
  private handshakeSessionId?: string;
  private startPromise?: Promise<void>;
  private readonly probeAbort = new AbortController();
  private probeExit?: Promise<void>;
  private closePromise?: Promise<void>;
  private readonly operationContext?: PiRpcOperationContext;

  constructor(options: PiRpcClientOptions) {
    this.options = options;
    if (options.operationContext) this.operationContext = new PiRpcOperationContext();
    this.transport = new RpcStdioClient({
      args: [
        '--mode',
        'rpc',
        ...options.args,
        ...(this.operationContext ? ['-e', this.operationContext.path] : []),
      ],
      closeGraceMs: options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
      commandPath: options.commandPath,
      cwd: options.cwd,
      detached: options.detached,
      env: options.env,
      isResponse: (message) => message?.type === 'response',
      onError: (error) => {
        this.operationContext?.cancel(error);
        options.onError?.(this.toConnectionError(error));
      },
      onMessage: (message) => this.handleNonResponse(message),
      onRawStdout: options.onRawStdout,
      onStderr: options.onStderr,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  get pid(): number | undefined {
    return this.transport.pid;
  }

  get isClosed(): boolean {
    return this.transport.isClosed;
  }

  /** True once the startup handshake succeeded (`get_state` answered). */
  get isReady(): boolean {
    return this.handshakeResolved && !this.transport.isClosed;
  }

  /**
   * The native pi session id reported by the `get_state` handshake.
   *
   * Note: RPC mode never emits the `{type:'session'}` header that the legacy
   * `--mode json` stream starts with — the session id only exists in the
   * `get_state` response — so this is the ONLY reliable source for it.
   */
  get sessionId(): string | undefined {
    return this.handshakeSessionId;
  }

  /**
   * Spawn the process and complete the startup handshake. Rejects with a
   * `PiRpcConnectionError` when pi cannot start or does not answer
   * `get_state` within the handshake timeout — the hard-fail guarantee: an
   * unsupported / broken pi install surfaces as a clear error instead of a
   * silent hang.
   */
  start(): Promise<void> {
    this.startPromise ??= this.startProcess();
    return this.startPromise;
  }

  private async startProcess(): Promise<void> {
    try {
      this.assertOpen();
      await this.checkVersion();
      this.assertOpen();
      await this.operationContext?.prepare();
      this.assertOpen();
      await this.transport.start();
      this.assertOpen();
      await this.performHandshake();
      if (this.operationContext) {
        try {
          const response = await this.command<{ commands: { name: string; source: string }[] }>(
            { type: 'get_commands' },
            PI_RPC_HANDSHAKE_TIMEOUT_MS,
          );
          if (
            !response.data?.commands.some(
              (command) =>
                command.name === this.operationContext!.commandName &&
                command.source === 'extension',
            )
          ) {
            throw new Error('Pi did not load the operation context extension');
          }
        } catch (error) {
          this.assertOpen();
          throw new PiOperationContextUnavailableError('Pi operation context unavailable', {
            cause: error,
          });
        }
      }
    } catch (error) {
      // The process never reached a usable state — do not leave it running.
      await this.close();
      throw error instanceof PiRpcConnectionError ||
        error instanceof PiOperationContextUnavailableError
        ? error
        : this.toConnectionError(error);
    }
  }

  private assertOpen(): void {
    if (this.probeAbort.signal.aborted)
      throw new PiRpcConnectionError('Pi RPC client closed by host');
  }

  private async checkVersion(): Promise<void> {
    const plan = await resolveCliSpawnPlan(this.options.commandPath, ['--version']);
    this.assertOpen();
    let version: string;
    try {
      version = await new Promise<string>((resolve, reject) => {
        const probe = execFile(
          plan.command,
          plan.args,
          {
            cwd: this.options.cwd,
            env: this.options.env,
            killSignal: 'SIGKILL',
            signal: this.probeAbort.signal,
            timeout: 5000,
            windowsHide: true,
          },
          (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout.trim());
          },
        );
        this.probeExit = new Promise<void>((resolveExit) => {
          probe.once('close', () => resolveExit());
          probe.once('error', () => {
            if (!probe.pid) resolveExit();
          });
        });
      });
    } catch {
      throw new PiRpcConnectionError(
        `Cannot verify Pi version. Pi >= ${PI_RPC_MIN_CLI_VERSION} is required; upgrade pi or check the install.`,
        { phase: 'spawn' },
      );
    }
    // Require a stable CLI release. get_state alone is not capability
    // negotiation: older releases answer it but never emit agent_settled.
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+[\dA-Za-z.-]+)?$/.exec(version);
    const minimum = PI_RPC_MIN_CLI_VERSION.split('.').map(Number);
    const difference =
      match
        ?.slice(1)
        .map(Number)
        .map((part, index) => part - minimum[index])
        .find((part) => part !== 0) ?? 0;
    if (!match || difference < 0) {
      throw new PiRpcConnectionError(
        `Pi >= ${PI_RPC_MIN_CLI_VERSION} (stable) is required; upgrade pi to use RPC.`,
        { phase: 'spawn' },
      );
    }
  }

  /**
   * Send a command and await its response. Rejects on `success: false`,
   * timeout, or connection failure. Note: for `prompt`, pi answers as soon as
   * the message is accepted/queued — the run's outcome arrives as events.
   */
  async command<T = any>(
    command: PiRpcCommand,
    timeoutMs?: number | false,
  ): Promise<PiRpcResponse<T>> {
    try {
      const response = await this.transport.request<PiRpcResponse<T>>(
        command,
        timeoutMs ?? this.options.requestTimeoutMs ?? PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS,
        command.type,
      );
      if (!response.success) {
        throw new PiRpcResponseError(response.command, response.error ?? 'Unknown error');
      }
      return response;
    } catch (error) {
      if (error instanceof RpcStdioConnectionError) {
        throw this.toConnectionError(error);
      }
      throw error;
    }
  }

  /** Bound the abort ACK independently of ordinary command timeout settings. */
  async abort(): Promise<void> {
    await this.command({ type: 'abort' }, PI_RPC_ABORT_TIMEOUT_MS);
  }

  /**
   * Graceful close: send EOF, wait for pi to exit, escalate only if needed.
   * Resolves when the child is gone (or was never spawned).
   */
  close(options?: { force?: boolean }): Promise<void> {
    this.probeAbort.abort();
    this.operationContext?.cancel(new PiRpcConnectionError('Pi RPC client closed by host'));
    const transportClose = this.transport.close(options);
    this.closePromise ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.all([
          transportClose,
          Promise.race([
            this.probeExit ?? Promise.resolve(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new PiRpcConnectionError('Pi version probe did not exit after cancellation'),
                  ),
                PI_RPC_ABORT_TIMEOUT_MS,
              );
            }),
          ]),
        ]);
        await this.operationContext?.dispose();
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.closePromise;
  }

  async setOperationContext(value: string | null): Promise<void> {
    await this.operationContext?.update('set', value, (command, timeout) =>
      this.command(command, timeout),
    );
  }

  async clearOperationContext(): Promise<void> {
    await this.operationContext?.update('clear', null, (command, timeout) =>
      this.command(command, timeout),
    );
  }

  private async performHandshake(): Promise<void> {
    // No command-level timeout on the handshake — the watchdog below owns it
    // so the failure message is deterministic.
    const handshake = this.command<{ sessionId?: string; sessionFile?: string }>(
      { type: 'get_state' },
      false,
    );
    const timeout = setTimeout(() => {
      // Reject the pending handshake directly; start() then recycles the
      // process. The message must be deterministic — no generic timeout text.
      this.transport.abortPendingRequests(
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
          { phase: 'handshake', stderr: this.transport.stderrText },
        );
      }
      this.handshakeResolved = true;
      if (typeof response.data?.sessionId === 'string') {
        this.handshakeSessionId = response.data.sessionId;
      }
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /** Everything that is not a command response: events + extension UI. */
  private async handleNonResponse(message: Record<string, unknown>): Promise<void> {
    if (message.type === 'extension_ui_request') {
      await this.handleExtensionUiRequest(message as unknown as PiExtensionUiRequest);
      return;
    }
    await this.options.onEvent(message as PiRpcEvent);
  }

  private async handleExtensionUiRequest(request: PiExtensionUiRequest): Promise<void> {
    if (this.operationContext?.consume(request)) return;
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
    this.transport.notify(
      (response ?? { cancelled: true, id: request.id, type: 'extension_ui_response' }) as Record<
        string,
        unknown
      >,
    );
  }

  private toConnectionError(error: unknown): PiRpcConnectionError {
    const phase =
      error instanceof RpcStdioConnectionError && error.options?.phase === 'spawn'
        ? 'spawn'
        : 'run';
    const message = error instanceof Error ? error.message : String(error);
    const stderr = error instanceof RpcStdioConnectionError ? error.options?.stderr : undefined;
    return new PiRpcConnectionError(message, {
      phase,
      stderr: stderr ?? this.transport.stderrText,
    });
  }
}
