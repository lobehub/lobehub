import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline, type UploadHeterogeneousImage } from '../spawn/agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from '../spawn/claudeAgentSdkSession';
import { PiRpcClient, PiRpcConnectionError, PiRpcResponseError } from './piRpcClient';
import {
  type PiExtensionUiRequest,
  type PiExtensionUiResponse,
  type PiMessageEndEvent,
  type PiMessageUpdateEvent,
  type PiRpcCommand,
  type PiRpcEvent,
  type PiRpcImage,
  type PiSessionEvent,
} from './piRpcProtocol';

/** Text + base64 image content for a single prompt. */
export interface PiRpcPromptInput {
  images?: PiRpcImage[];
  text: string;
}

export interface PiRpcSessionOptions {
  /** Extra CLI args (user/provider-configured), e.g. `--provider`, `--model`. */
  args: string[];
  /**
   * When true (default), `run()` recycles its process once the run settles
   * (per-run lifecycle — one run owns one process). When false, the process
   * survives the run so the host can reuse it for follow-up turns; the host
   * owns `close()` (e.g. an idle reaper). `run()` stays re-entrant: call it
   * again for the next turn on the same session.
   */
  autoCloseOnSettle?: boolean;
  /** Absolute (or resolved) path to the `pi` executable. */
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** How long a run may go without any event before it is considered stale. */
  inactivityTimeoutMs?: number;
  onEvents: (events: AgentStreamEvent[]) => void | Promise<void>;
  /** Extension UI dialogs — return a response to answer, or `undefined` to cancel. */
  onExtensionUiRequest?: (
    request: PiExtensionUiRequest,
  ) => Promise<PiExtensionUiResponse | undefined> | PiExtensionUiResponse | undefined;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  /** Freshest native pi session id (RPC mode: from the get_state handshake). */
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => void | Promise<void>;
  /** Renderer-side operation id stamped onto every emitted event. */
  operationId: string;
  /** Native pi session id to resume (`--session-id <id>` at spawn). */
  resumeSessionId?: string;
  /** LobeHub session id — used for runtime status and diagnostics only. */
  sessionId: string;
  /** Uploader for base64 tool_result images (see `AgentStreamPipelineOptions`). */
  uploadImage?: UploadHeterogeneousImage;
}

/** Host callbacks a pooled process can be rebound to between runs. */
export interface PiRpcSessionCallbacks {
  onEvents: (events: AgentStreamEvent[]) => void | Promise<void>;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => void | Promise<void>;
  operationId: string;
  sessionId: string;
}

const DEFAULT_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const ABORTED_REASON = 'aborted';

const isTerminalAbortedEvent = (event: PiRpcEvent): boolean => {
  if (event.type === 'message_update') {
    const update = (event as PiMessageUpdateEvent).assistantMessageEvent;
    if (update?.type !== 'error') return false;
    return update.reason === ABORTED_REASON || update.error?.stopReason === ABORTED_REASON;
  }
  if (event.type === 'message_end') {
    const message = (event as PiMessageEndEvent).message;
    return message?.stopReason === ABORTED_REASON;
  }
  return false;
};

/**
 * One Pi RPC process, optionally reused across sequential prompt runs.
 * AgentStreamPipeline owns retry/error semantics; only agent_settled releases
 * the process for reuse. Connection failures close it instead.
 */
export class PiRpcSession {
  private callbacks: PiRpcSessionCallbacks;
  private readonly client: PiRpcClient;
  private pipeline: AgentStreamPipeline;
  private readonly inactivityTimeoutMs: number;
  private aborted = false;
  private lastEventAt = Date.now();
  private inactivityTimer?: NodeJS.Timeout;
  private resolveRun?: (result: { aborted: boolean }) => void;
  private rejectRun?: (error: Error) => void;
  private runStarted = false;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private closed = false;

  constructor(private readonly options: PiRpcSessionOptions) {
    this.callbacks = options;
    this.inactivityTimeoutMs = options.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
    this.pipeline = this.createPipeline();
    this.client = new PiRpcClient({
      // Resume the native pi session when one is known — mirrors the legacy
      // `--session-id` resume of the json path.
      args: [
        ...(options.resumeSessionId ? ['--session-id', options.resumeSessionId] : []),
        ...options.args,
      ],
      commandPath: options.commandPath,
      cwd: options.cwd,
      env: options.env,
      onError: (error) => this.failRun(error),
      onEvent: (event) => this.handleEvent(event),
      onExtensionUiRequest: options.onExtensionUiRequest,
      onStderr: (data) => this.callbacks.onStderr(data),
    });
  }

  get pid(): number | undefined {
    return this.client.pid;
  }

  /**
   * Rebind the host callbacks — required when a pooled process is reused by
   * a later run whose IPC session (and trace) differs from the run that
   * spawned the process.
   */
  rebind(callbacks: PiRpcSessionCallbacks): void {
    if (this.runStarted) throw new Error('PiRpcSession already has an active run');
    this.callbacks = callbacks;
  }

  private createPipeline(): AgentStreamPipeline {
    return new AgentStreamPipeline({
      agentType: 'pi',
      cwd: this.options.cwd,
      operationId: this.callbacks.operationId,
      uploadImage: this.options.uploadImage,
    });
  }

  /** True while a prompt run is in flight — the pool won't reuse a busy session. */
  get isRunning(): boolean {
    return this.runStarted;
  }

  get isReusable(): boolean {
    return !this.closed && !this.runStarted && this.client.isReady;
  }

  /**
   * Start the RPC process and handshake. Idempotent. Rejects with a
   * `PiRpcConnectionError` on spawn/handshake failure (hard-fail).
   */
  start(): Promise<void> {
    if (this.closed) return Promise.reject(new PiRpcConnectionError('Pi RPC session is closed'));
    this.startPromise ??= this.client.start().then(() => {
      if (this.closed) throw new PiRpcConnectionError('Pi RPC session is closed');
      const sessionId = this.client.sessionId;
      if (sessionId) this.callbacks.onSessionId(sessionId);
      this.emitStatus('idle');
    });
    return this.startPromise;
  }

  /**
   * Run one prompt to completion. Resolves `{ aborted: false }` on
   * `agent_settled`; `{ aborted: true }` when the run was interrupted;
   * rejects on error / process death. Failed runs always close the process.
   */
  async run(prompt: PiRpcPromptInput): Promise<{ aborted: boolean }> {
    if (this.runStarted) throw new Error('PiRpcSession already has an active run');
    if (this.closed) throw new PiRpcConnectionError('Pi RPC session is closed');
    // Reserve before awaiting startup. Each turn needs a fresh PiAdapter.
    this.pipeline = this.createPipeline();
    this.runStarted = true;
    this.aborted = false;
    const completion = new Promise<{ aborted: boolean }>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
    const sendPrompt = async () => {
      await this.start();
      if (this.closed) throw new PiRpcConnectionError('Pi RPC session is closed');
      this.armInactivityTimer();
      this.emitStatus('running');
      const command: PiRpcCommand = {
        type: 'prompt',
        message: prompt.text,
        ...(prompt.images?.length ? { images: prompt.images } : {}),
      };
      const response = await this.client.command(command);
      if (!response.success) {
        throw new PiRpcResponseError('prompt', response.error ?? 'Unknown error');
      }
      if (this.aborted) await this.client.abort();
    };
    let failed = false;
    try {
      // Observe both promises immediately: process death may precede the ACK,
      // and agent_settled may arrive before command() resumes.
      const [result] = await Promise.all([completion, sendPrompt()]);
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.clearInactivityTimer();
      this.resolveRun = undefined;
      this.rejectRun = undefined;
      if (failed || this.options.autoCloseOnSettle !== false) {
        await this.close().catch(() => {
          /* best-effort cleanup */
        });
      }
      this.runStarted = false;
    }
  }

  /** Gracefully interrupt the current run (sends `abort`, closes afterwards). */
  async abort(): Promise<void> {
    if (!this.runStarted) return;
    this.aborted = true;
    if (!this.client.isReady) return;
    try {
      await this.client.abort();
    } catch (error) {
      // If the connection is already gone the run will settle via close.
      if (error instanceof PiRpcResponseError) throw error;
    }
  }

  /** Close the underlying process (graceful EOF → escalate). */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.clearInactivityTimer();
    this.closePromise = this.client.close().finally(() => {
      this.settleRun({ aborted: true });
      this.emitStatus('closed');
    });
    return this.closePromise;
  }

  /** Send a follow-up message while the process is (briefly) alive. */
  async followUp(message: string, images?: PiRpcImage[]): Promise<void> {
    await this.client.command({
      type: 'follow_up',
      message,
      ...(images?.length ? { images } : {}),
    });
  }

  /** Send a steering message while the process is (briefly) alive. */
  async steer(message: string, images?: PiRpcImage[]): Promise<void> {
    await this.client.command({ type: 'steer', message, ...(images?.length ? { images } : {}) });
  }

  /** Manually compact the session context. */
  async compact(customInstructions?: string): Promise<void> {
    await this.client.command({
      type: 'compact',
      ...(customInstructions ? { customInstructions } : {}),
    });
  }

  private async handleEvent(event: PiRpcEvent): Promise<void> {
    if (this.closed) return;
    this.lastEventAt = Date.now();

    // Capture the pipeline for THIS event — `run()` swaps in a fresh pipeline
    // (new PiAdapter per run) after start(), and push + flush must stay on
    // the same instance or a deferred adapter error would be flushed against
    // an empty state.
    const pipeline = this.pipeline;

    if (event.type === 'session') {
      const sessionEvent = event as PiSessionEvent;
      if (typeof sessionEvent.id === 'string') this.callbacks.onSessionId(sessionEvent.id);
      return;
    }

    if (!this.runStarted) return;
    this.armInactivityTimer();
    if (isTerminalAbortedEvent(event)) this.aborted = true;
    const events = await this.pushEvent(event, pipeline);
    if (event.type !== 'agent_settled') return;
    const error = events.find((item) => item.type === 'error');
    if (error) this.failRun(new Error(error.data.message ?? 'Pi run failed'));
    else this.settleRun({ aborted: this.aborted });
  }

  private async pushEvent(
    event: PiRpcEvent,
    pipeline: AgentStreamPipeline,
  ): Promise<AgentStreamEvent[]> {
    // Serialize back to a JSONL line and reuse the same pipeline the legacy
    // CLI path uses — PiAdapter consumes the identical event shapes.
    const line = `${JSON.stringify(event)}\n`;
    const events = await pipeline.push(line);
    if (pipeline.sessionId) this.callbacks.onSessionId(pipeline.sessionId);
    await this.callbacks.onEvents(events);
    return events;
  }

  private settleRun(result: { aborted: boolean }): void {
    const resolve = this.resolveRun;
    this.resolveRun = undefined;
    this.rejectRun = undefined;
    resolve?.(result);
  }

  private failRun(error: Error): void {
    const reject = this.rejectRun;
    this.resolveRun = undefined;
    this.rejectRun = undefined;
    reject?.(error);
  }

  private armInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      if (!this.runStarted) return;
      const error = new PiRpcConnectionError(
        `Pi RPC produced no events for ${this.inactivityTimeoutMs}ms`,
        { phase: 'run' },
      );
      this.emitStatus('stale');
      this.failRun(error);
      void this.close().catch(() => {
        /* best-effort */
      });
    }, this.inactivityTimeoutMs);
    this.inactivityTimer.unref?.();
  }

  private clearInactivityTimer(): void {
    if (!this.inactivityTimer) return;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = undefined;
  }

  private emitStatus(state: HeterogeneousAgentRuntimeStatus['state']): void {
    this.callbacks.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: this.lastEventAt,
      operationId: this.callbacks.operationId,
      sessionId: this.callbacks.sessionId,
      state,
      transport: 'pi-rpc',
    });
  }
}
