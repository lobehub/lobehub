import {
  PI_RPC_DEFAULT_REQUEST_TIMEOUT_MS,
  PI_RPC_HANDSHAKE_TIMEOUT_MS,
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
  private started = false;

  constructor(options: PiRpcClientOptions) {
    this.options = options;
    this.transport = new RpcStdioClient({
      args: ['--mode', 'rpc', ...options.args],
      closeGraceMs: options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
      commandPath: options.commandPath,
      cwd: options.cwd,
      env: options.env,
      isResponse: (message) => message?.type === 'response',
      onMessage: (message) => this.handleNonResponse(message),
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
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.transport.start();
      await this.performHandshake();
    } catch (error) {
      // The process never reached a usable state — do not leave it running.
      await this.close().catch(() => {
        /* best-effort */
      });
      throw error instanceof PiRpcConnectionError ? error : this.toConnectionError(error);
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

  /** Send `abort` without resolving the close lifecycle. */
  async abort(): Promise<void> {
    try {
      await this.command({ type: 'abort' }, false);
    } catch (error) {
      if (error instanceof PiRpcResponseError) throw error;
      // Connection already broken — the run is over either way.
    }
  }

  /**
   * Graceful close: send EOF, wait for pi to exit, escalate only if needed.
   * Resolves when the child is gone (or was never spawned).
   */
  close(): Promise<void> {
    return this.transport.close();
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
    const phase = error instanceof RpcStdioConnectionError && error.options?.phase === 'spawn' ? 'spawn' : 'run';
    const message = error instanceof Error ? error.message : String(error);
    const stderr = error instanceof RpcStdioConnectionError ? error.options?.stderr : undefined;
    return new PiRpcConnectionError(message, {
      phase,
      stderr: stderr ?? this.transport.stderrText,
    });
  }
}
