import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isRecord } from '@lobechat/utils/object';

import type { AcpRpcMessage } from './acpStdioClient';
import { AcpStdioClient } from './acpStdioClient';
import type { AgentStreamPipelineOptions } from './agentStreamPipeline';
import { AgentStreamPipeline } from './agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from './claudeAgentSdkSession';

/** The ACP major protocol version this client speaks (https://agentclientprotocol.com). */
export const ACP_PROTOCOL_VERSION = 1;

const DEFAULT_CANCEL_GRACE_MS = 2_000;

/** One entry of a `session/request_permission` `options` array. */
export interface AcpPermissionOption {
  kind?: unknown;
  optionId?: unknown;
}

/** Parse the `options` array of a `session/request_permission` request. */
export const parseAcpPermissionOptions = (params: unknown): AcpPermissionOption[] => {
  const options = isRecord(params) ? params.options : undefined;
  if (!Array.isArray(options)) return [];
  return options.flatMap((value) => (isRecord(value) ? [value as AcpPermissionOption] : []));
};

/**
 * Pick a permission option by ordered preference tiers. Returns the winning
 * option's id, or `undefined` when no tier matched — or when the first
 * matching tier's option carries no usable string `optionId` (mirrors the
 * `a ?? b ?? c` fall-through the per-agent policies used before extraction:
 * later tiers are not consulted once an earlier tier matched).
 */
export const selectAcpPermissionOption = (
  params: unknown,
  preferences: ((option: AcpPermissionOption) => boolean)[],
): string | undefined => {
  const options = parseAcpPermissionOptions(params);
  for (const matches of preferences) {
    const selected = options.find((option) => matches(option));
    if (selected) return typeof selected.optionId === 'string' ? selected.optionId : undefined;
  }
  return undefined;
};

/** Options shared by every ACP agent session, independent of the vendor. */
export interface AcpAgentSessionOptions {
  args: string[];
  clientVersion: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  onRawMessage: (line: string) => Promise<void> | void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => Promise<void> | void;
  operationId: string;
  requestTimeoutMs?: number;
  resumeSessionId?: string;
  sessionId: string;
}

/** Per-agent invariants a subclass passes to the base constructor. */
export interface AcpAgentSessionConfig {
  /** Full child argv (agent-fixed flags already applied around user args). */
  args: string[];
  /** Grace period between `session/cancel` and force-closing the process. */
  cancelGraceMs?: number;
  /** `AgentStreamPipeline` construction params (`operationId` is appended from options). */
  pipeline: Omit<AgentStreamPipelineOptions, 'operationId'>;
  processLabel: string;
  transport: HeterogeneousAgentRuntimeStatus['transport'];
}

/**
 * Shared ACP v1 agent lifecycle layered on {@link AcpStdioClient}:
 *
 *   initialize (+ version/capability validation) → session/new | session/load
 *   → session/prompt → session/update streaming → session/cancel
 *
 * The base owns everything the protocol standardizes — transport wiring,
 * request/notification plumbing, prompt-turn settlement, cancellation grace,
 * and runtime-status reporting. Vendor deltas (extension `_meta` payloads,
 * auth, model selection, replay policy, reverse-request policy) live in the
 * protocol-phase hooks implemented by each agent's subclass.
 */
export abstract class AcpAgentSession<
  TInitializeResult,
  TOptions extends AcpAgentSessionOptions = AcpAgentSessionOptions,
> {
  protected readonly client: AcpStdioClient;
  protected readonly pipeline: AgentStreamPipeline;
  /** The agent-native session id, set as soon as session setup resolves it. */
  protected acpSessionId?: string;

  private readonly cancelGraceMs: number;
  private readonly transport: HeterogeneousAgentRuntimeStatus['transport'];
  private cancelTimer?: ReturnType<typeof setTimeout>;
  private hostClosed = false;
  private lastStatus?: HeterogeneousAgentRuntimeStatus['state'];

  protected constructor(
    protected readonly options: TOptions,
    config: AcpAgentSessionConfig,
  ) {
    this.cancelGraceMs = config.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
    this.transport = config.transport;
    this.pipeline = new AgentStreamPipeline({
      ...config.pipeline,
      operationId: options.operationId,
    });
    this.client = new AcpStdioClient({
      args: config.args,
      commandPath: options.commandPath,
      cwd: options.cwd,
      env: options.env,
      onMessage: (message) => this.handleAgentMessage(message),
      onRawMessage: options.onRawMessage,
      onServerRequest: (message) => this.handleServerRequest(message),
      onStderr: options.onStderr,
      processLabel: config.processLabel,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  get pid(): number | undefined {
    return this.client.pid;
  }

  protected get closedByHost(): boolean {
    return this.hostClosed;
  }

  /** Run one full prompt turn. Resolves silently when the host closed the session mid-run. */
  async run(): Promise<void> {
    this.emitStatus('starting');
    try {
      await this.prepareRun?.();
      const initialized = await this.initializeConnection();
      const sessionId = await this.establishSession(initialized);
      this.acpSessionId = sessionId;
      this.emitStatus('running');
      this.onBeforePrompt?.();
      const result = await this.client.request<unknown>(
        'session/prompt',
        await this.buildPromptParams(sessionId),
        false,
      );
      await this.settlePrompt(result);
      if (this.hostClosed) return;
      await this.emitEvents(await this.pipeline.flush());
      if (this.hostClosed) return;
      this.emitStatus('idle');
    } catch (cause) {
      if (this.hostClosed) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.onRunFailure?.(error);
      this.emitStatus('error');
      throw error;
    } finally {
      if (this.cancelTimer) clearTimeout(this.cancelTimer);
      this.client.close();
      this.emitStatus('closed');
    }
  }

  /**
   * Request graceful cancellation via the `session/cancel` notification; the
   * agent is expected to resolve the pending `session/prompt` with the
   * `cancelled` stop reason. Force-closes after the grace period.
   */
  interrupt(): void {
    const sessionId = this.acpSessionId;
    if (!sessionId) {
      this.close();
      return;
    }
    this.client.notify('session/cancel', this.buildCancelParams(sessionId));
    this.cancelTimer ??= setTimeout(() => this.close(), this.cancelGraceMs);
    this.cancelTimer.unref?.();
  }

  /** Host-forced shutdown: suppresses further events and kills the child. */
  close(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.hostClosed) return;
    this.hostClosed = true;
    this.onHostClose?.();
    this.client.close(signal);
    this.emitStatus('closed');
  }

  /** Start the child (idempotent), send `initialize`, and validate the result. */
  protected async initializeConnection(): Promise<TInitializeResult> {
    await this.client.start();
    const initialized = await this.client.request<TInitializeResult>(
      'initialize',
      this.buildInitializeParams(),
    );
    this.validateInitialized(initialized);
    return initialized;
  }

  /**
   * Settle the prompt turn after the `session/prompt` response arrives. The
   * default drains the already-received message queue; agents whose CLIs leak
   * trailing notifications or need synthetic terminal events override this.
   */
  protected async settlePrompt(_result: unknown): Promise<void> {
    await this.client.drain();
  }

  /** `session/cancel` params; agents append extension `_meta` by overriding. */
  protected buildCancelParams(sessionId: string): unknown {
    return { sessionId };
  }

  /** Serialize a payload as one JSONL line into the adapter pipeline and emit the result. */
  protected async pushToPipeline(payload: unknown): Promise<void> {
    if (this.hostClosed) return;
    const events = await this.pipeline.push(`${JSON.stringify(payload)}\n`);
    await this.emitEvents(events);
  }

  protected async emitEvents(events: AgentStreamEvent[]): Promise<void> {
    if (!this.hostClosed && events.length > 0) await this.options.onEvents(events);
  }

  protected emitStatus(state: HeterogeneousAgentRuntimeStatus['state']): void {
    if (this.lastStatus === 'closed' || state === this.lastStatus) return;
    this.lastStatus = state;
    this.options.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: Date.now(),
      operationId: this.options.operationId,
      sessionId: this.options.sessionId,
      state,
      transport: this.transport,
    });
  }

  /** `initialize` request params (client capabilities, client info, extensions). */
  protected abstract buildInitializeParams(): unknown;

  /**
   * Validate the `initialize` response — protocol version and any
   * capabilities the pending run depends on. Throw to abort before any
   * session is created.
   */
  protected abstract validateInitialized(initialized: TInitializeResult): void;

  /**
   * Everything between `initialize` and `session/prompt`: authentication,
   * `session/new` / `session/load`, model selection, and `onSessionId`
   * notification. Returns the agent-native session id to prompt against.
   */
  protected abstract establishSession(initialized: TInitializeResult): Promise<string>;

  /** `session/prompt` request params. */
  protected abstract buildPromptParams(sessionId: string): Promise<unknown> | unknown;

  /** Route an agent-initiated message (notification or response) into the pipeline. */
  protected abstract handleAgentMessage(message: AcpRpcMessage): Promise<void> | void;

  /** Answer an agent→client request (`session/request_permission`, extensions). */
  protected abstract handleServerRequest(message: AcpRpcMessage): Promise<unknown> | unknown;

  /** Optional async setup that must precede spawning the child (e.g. prompt materialization). */
  protected prepareRun?(): Promise<void>;

  /** Invoked right before the `session/prompt` request is written. */
  protected onBeforePrompt?(): void;

  /** Emit synthetic terminal events for a failed run before the error is rethrown. */
  protected onRunFailure?(error: Error): Promise<void>;

  /** Extra cleanup when the host force-closes the session. */
  protected onHostClose?(): void;
}
