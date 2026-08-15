import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline, type UploadHeterogeneousImage } from '../spawn/agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from '../spawn/claudeAgentSdkSession';
import { PiRpcClient, PiRpcConnectionError, PiRpcResponseError } from './piRpcClient';
import {
  type PiAgentSettledEvent,
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
  text: string;
  images?: PiRpcImage[];
}

export interface PiRpcSessionOptions {
  /** Extra CLI args (user/provider-configured), e.g. `--provider`, `--model`. */
  args: string[];
  /** Absolute (or resolved) path to the `pi` executable. */
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Renderer-side operation id stamped onto every emitted event. */
  operationId: string;
  /** LobeHub session id — used for runtime status and diagnostics only. */
  sessionId: string;
  /** Native pi session id to resume (`--session-id <id>` at spawn). */
  resumeSessionId?: string;
  /** Uploader for base64 tool_result images (see `AgentStreamPipelineOptions`). */
  uploadImage?: UploadHeterogeneousImage;
  onEvents: (events: AgentStreamEvent[]) => void | Promise<void>;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  /** Freshest native pi session id (RPC mode: from the get_state handshake). */
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => void | Promise<void>;
  /** Extension UI dialogs — return a response to answer, or `undefined` to cancel. */
  onExtensionUiRequest?: (
    request: PiExtensionUiRequest,
  ) => Promise<PiExtensionUiResponse | undefined> | PiExtensionUiResponse | undefined;
  /** How long a run may go without any event before it is considered stale. */
  inactivityTimeoutMs?: number;
  /**
   * When true (default), `run()` recycles its process once the run settles
   * (per-run lifecycle — one run owns one process). When false, the process
   * survives the run so the host can reuse it for follow-up turns; the host
   * owns `close()` (e.g. an idle reaper). `run()` stays re-entrant: call it
   * again for the next turn on the same session.
   */
  autoCloseOnSettle?: boolean;
}

/** Host callbacks a pooled process can be rebound to between runs. */
export interface PiRpcSessionCallbacks {
  onEvents: (events: AgentStreamEvent[]) => void | Promise<void>;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => void | Promise<void>;
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

const isTerminalErrorEvent = (event: PiRpcEvent): boolean => {
  if (event.type !== 'message_update') return false;
  const update = (event as PiMessageUpdateEvent).assistantMessageEvent;
  if (update?.type !== 'error') return false;
  // Aborts are handled separately (not errors).
  return update.reason !== ABORTED_REASON && update.error?.stopReason !== ABORTED_REASON;
};

const getTerminalErrorMessage = (event: PiRpcEvent): string | undefined => {
  if (event.type !== 'message_update') return;
  const error = (event as PiMessageUpdateEvent).assistantMessageEvent?.error;
  if (typeof error?.errorMessage === 'string' && error.errorMessage) return error.errorMessage;
  if (typeof error?.message === 'string' && error.message) return error.message;
  return;
};

/**
 * A single run of pi over the RPC transport.
 *
 * Spawns `pi --mode rpc` (or reuses nothing — one session = one process,
 * matching the desktop per-run lifecycle), sends the prompt command, and maps
 * every raw RPC event through the shared `AgentStreamPipeline` (JSONL →
 * PiAdapter → `AgentStreamEvent`) so consumers see the exact same wire shape
 * as the legacy `--mode json` path. The run resolves when pi reports
 * `agent_settled` (no retry / compaction / queued continuation remains), or
 * when the run is aborted / errored / the process dies. The process is closed
 * gracefully (`stdin.end()` → pi exits 0) at run end.
 *
 * Hard-fail semantics: an unsupported or broken pi install rejects the run
 * with a classified error — there is no silent degradation.
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
  private runPromise?: Promise<{ aborted: boolean }>;
  private runStarted = false;
  private started = false;

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
    this.callbacks = callbacks;
  }

  private createPipeline(): AgentStreamPipeline {
    return new AgentStreamPipeline({
      agentType: 'pi',
      cwd: this.options.cwd,
      operationId: this.options.operationId,
      uploadImage: this.options.uploadImage,
    });
  }

  /** True while a prompt run is in flight — the pool won't reuse a busy session. */
  get isRunning(): boolean {
    return this.runStarted;
  }

  /**
   * Start the RPC process and handshake. Idempotent. Rejects with a
   * `PiRpcConnectionError` on spawn/handshake failure (hard-fail).
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.client.start();
    // RPC mode does not emit the json-mode `{type:'session'}` header — the
    // native session id comes from the get_state handshake. Report it so the
    // host can key the pool / persist the resume id.
    const sessionId = this.client.sessionId;
    if (sessionId) this.callbacks.onSessionId(sessionId);
    this.emitStatus('idle');
  }

  /**
   * Run one prompt to completion. Resolves `{ aborted: false }` on
   * `agent_settled`; `{ aborted: true }` when the run was interrupted;
   * rejects on error / process death. Always closes the process afterwards.
   */
  async run(prompt: PiRpcPromptInput): Promise<{ aborted: boolean }> {
    try {
      await this.start();
    } catch (error) {
      // start() failure (spawn / handshake) must still recycle the process.
      await this.close().catch(() => {
        /* best-effort */
      });
      throw error;
    }
    if (this.runPromise) throw new Error('PiRpcSession already has an active run');

    // The PiAdapter is a state machine that settles after one run — a reused
    // process must start each run with a fresh pipeline (new adapter), or
    // every second-turn event would be dropped.
    this.pipeline = this.createPipeline();
    this.runStarted = true;
    this.aborted = false;
    this.runPromise = new Promise<{ aborted: boolean }>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
    this.armInactivityTimer();
    this.emitStatus('running');

    const command: PiRpcCommand = {
      type: 'prompt',
      message: prompt.text,
      ...(prompt.images?.length ? { images: prompt.images } : {}),
    };
    try {
      const response = await this.client.command(command);
      if (!response.success) {
        throw new PiRpcResponseError('prompt', response.error ?? 'Unknown error');
      }
    } catch (error) {
      // The command was never accepted — no run to settle.
      this.runPromise = undefined;
      this.resolveRun = undefined;
      this.rejectRun = undefined;
      throw error;
    }
    // The command response only means "accepted" — the run's outcome
    // arrives as events (settled / aborted / error).
    try {
      return await this.runPromise;
    } finally {
      // A run is done once it settles; the process lifecycle depends on the
      // host: per-run recycles here, pooled sessions survive for reuse.
      this.clearInactivityTimer();
      this.runStarted = false;
      if (this.options.autoCloseOnSettle !== false) {
        await this.close().catch(() => {
          /* best-effort cleanup */
        });
      }
    }
  }

  /** Gracefully interrupt the current run (sends `abort`, closes afterwards). */
  async abort(): Promise<void> {
    this.aborted = true;
    try {
      await this.client.abort();
    } catch (error) {
      // If the connection is already gone the run will settle via close.
      if (error instanceof PiRpcResponseError) throw error;
    }
  }

  /** Close the underlying process (graceful EOF → escalate). */
  async close(): Promise<void> {
    this.clearInactivityTimer();
    await this.client.close();
    this.settleRun({ aborted: this.aborted });
    this.emitStatus('closed');
  }

  /** Send a follow-up message while the process is (briefly) alive. */
  async followUp(message: string, images?: PiRpcImage[]): Promise<void> {
    await this.client.command({ type: 'follow_up', message, ...(images?.length ? { images } : {}) });
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
    this.lastEventAt = Date.now();
    this.armInactivityTimer();

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

    if (event.type === 'agent_settled') {
      // The whole prompt (incl. retry/compaction/queued continuations) is
      // done — the run is complete.
      await this.pushEvent(event, pipeline);
      this.settleRun({ aborted: this.aborted });
      return;
    }

    if (isTerminalAbortedEvent(event)) {
      this.aborted = true;
      await this.pushEvent(event, pipeline);
      this.settleRun({ aborted: true });
      return;
    }

    if (isTerminalErrorEvent(event)) {
      await this.pushEvent(event, pipeline);
      // PiAdapter defers terminal errors until flush — materialize the error
      // + runtime-end events so the renderer can render the failure.
      const flushed = await pipeline.flush();
      await this.callbacks.onEvents(flushed);
      this.failRun(new Error(getTerminalErrorMessage(event) ?? 'Pi run failed'));
      return;
    }

    await this.pushEvent(event, pipeline);
  }

  private async pushEvent(event: PiRpcEvent, pipeline: AgentStreamPipeline): Promise<void> {
    // Serialize back to a JSONL line and reuse the same pipeline the legacy
    // CLI path uses — PiAdapter consumes the identical event shapes.
    const line = `${JSON.stringify(event)}\n`;
    const events = await pipeline.push(line);
    if (pipeline.sessionId) this.callbacks.onSessionId(pipeline.sessionId);
    await this.callbacks.onEvents(events);
  }

  private settleRun(result: { aborted: boolean }): void {
    const resolve = this.resolveRun;
    this.resolveRun = undefined;
    this.rejectRun = undefined;
    this.runPromise = undefined;
    resolve?.(result);
  }

  private failRun(error: Error): void {
    const reject = this.rejectRun;
    this.resolveRun = undefined;
    this.rejectRun = undefined;
    this.runPromise = undefined;
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
      operationId: this.options.operationId,
      sessionId: this.options.sessionId,
      state,
      transport: 'pi-rpc',
    });
  }
}
