import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isRecord, pickString } from '@lobechat/utils/object';

import { CodexAppServerAdapter } from '../adapters/codexAppServer';
import type { HeterogeneousAgentRuntimeStatus } from '../spawn/claudeAgentSdkSession';
import { toStreamEvent } from '../spawn/streamEvent';
import type { UsageData } from '../types';
import type { CodexAppServerClient } from './CodexAppServerClient';
import { CodexAppServerConnectionError } from './CodexAppServerClient';
import { withCodexThreadEnv } from './environment';
import type {
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  TurnCompletedNotification,
  TurnInterruptParams,
  TurnStartParams,
  TurnStartResponse,
  UserInput,
} from './protocol';

const CODEX_APP_SERVER_TRANSPORT = 'codex-app-server' as const;

const toThreadResumeParams = (threadId: string, params: ThreadStartParams): ThreadResumeParams => {
  const resumeParams = { ...params };
  delete resumeParams.ephemeral;
  delete resumeParams.serviceName;
  delete resumeParams.sessionStartSource;
  delete resumeParams.threadSource;
  return { ...resumeParams, threadId };
};

interface ActiveTurn {
  adapter: CodexAppServerAdapter;
  completion: Promise<void>;
  interruptRequest?: Promise<void>;
  interruptRequested: boolean;
  notificationError?: Error;
  notificationQueue: Promise<void>;
  operationId: string;
  resolve: () => void;
  terminalNotificationReceived: boolean;
  transportInterrupted: boolean;
  turnId?: string;
}

interface ThreadNameSetParams {
  name: string;
  threadId: string;
}

/** Input and callbacks for one turn on a persistent Codex thread. */
export interface CodexThreadTurnOptions {
  /**
   * Current run provenance for shell tools; credentials stay in the process environment.
   * @default undefined Retain the caller-provided thread configuration.
   */
  env?: Partial<NodeJS.ProcessEnv>;
  input: UserInput[];
  onRawMessage: (line: string) => Promise<void> | void;
  operationId: string;
}

export interface CodexThreadSessionOptions {
  client: CodexAppServerClient;
  initialCumulativeUsage?: UsageData;
  initialModel?: string;
  initialThreadId?: string;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  onModel?: (model: string) => void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  sessionId: string;
  /** A short title derived from the original user prompt, before injected context. */
  threadName?: string;
  threadParams: ThreadStartParams;
}

/** A persistent Codex thread state machine backed by the shared app-server client. */
export class CodexThreadSession {
  private activeTurn?: ActiveTurn;
  private attached = false;
  private releaseThread?: () => void;
  private hasThreadEnv = false;
  private threadParams: ThreadStartParams;
  private canFallback: boolean;
  private closedByHost = false;
  private cumulativeUsage?: UsageData;
  private interruptRequested = false;
  private lastOperationId?: string;
  private model?: string;
  private running = false;
  private readonly sessionUnsubscribers: Array<() => void> = [];
  private threadId?: string;
  private readonly threadUnsubscribers: Array<() => void> = [];

  constructor(private readonly options: CodexThreadSessionOptions) {
    this.canFallback = !options.initialThreadId;
    this.cumulativeUsage = options.initialCumulativeUsage;
    this.model = options.initialModel;
    this.threadId = options.initialThreadId;
    this.threadParams = options.threadParams;
    if (this.threadId) this.releaseThread = options.client.acquireThread(this.threadId);
    this.sessionUnsubscribers.push(
      options.client.acquireConsumer(),
      options.client.onDisconnect(() => this.handleDisconnect()),
    );
  }

  get canFallbackToExec(): boolean {
    return this.canFallback;
  }

  /**
   * Runs one turn with the current thread-local shell context.
   *
   * Use when:
   * - Sending a prompt to a new or resumed native Codex thread.
   *
   * Expects:
   * - At most one active turn per session; env contains the current run's IDs when provided.
   *
   * Returns:
   * - Resolves after ordered terminal events; transport and thread failures never replay a turn.
   *
   * Call stack:
   *
   * run
   *   -> {@link ensureThread}
   *     -> {@link CodexAppServerClient.request} (thread/start or thread/resume)
   *   -> {@link CodexAppServerClient.request} (turn/start)
   */
  async run(options: CodexThreadTurnOptions): Promise<void> {
    if (this.closedByHost) throw new Error('Codex thread session is closed');
    if (this.running) throw new Error('Codex thread already has a running turn');

    this.running = true;
    this.interruptRequested = false;
    this.lastOperationId = options.operationId;
    this.emitStatus('starting', options.operationId);
    const traceUnsubscribers: Array<() => void> = [];

    try {
      if (options.env) {
        const threadParams = withCodexThreadEnv(this.options.threadParams, options.env);
        if (JSON.stringify(threadParams.config) !== JSON.stringify(this.threadParams.config)) {
          // A disconnected client can still have old resume parameters queued for recovery.
          this.unsubscribeAll(this.threadUnsubscribers);
          this.attached = false;
        }
        this.hasThreadEnv = true;
        this.threadParams = threadParams;
      }
      await this.ensureThread();
      if (this.closedByHost) return;
      const threadId = this.threadId;
      if (!threadId) throw new Error('Codex thread is not attached');
      traceUnsubscribers.push(this.options.client.onRawMessage(threadId, options.onRawMessage));

      const adapter = new CodexAppServerAdapter({
        initialCumulativeUsage: this.cumulativeUsage,
        initialModel: this.model,
      });
      let resolveTurn!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
      const activeTurn: ActiveTurn = {
        adapter,
        completion,
        interruptRequested: this.interruptRequested,
        notificationQueue: Promise.resolve(),
        operationId: options.operationId,
        resolve: resolveTurn,
        terminalNotificationReceived: false,
        transportInterrupted: false,
      };
      this.activeTurn = activeTurn;

      const turnParams: TurnStartParams = { input: options.input, threadId };
      this.canFallback = false;
      const turn = await this.options.client.request<TurnStartResponse>('turn/start', turnParams);
      activeTurn.turnId = turn?.turn?.id;
      if (!activeTurn.turnId) throw new Error('Codex app-server returned no turn id');
      if (activeTurn.interruptRequested || this.closedByHost)
        await this.requestInterrupt(activeTurn);
      if (this.closedByHost) return;
      this.emitStatus('running', options.operationId);

      await activeTurn.completion;
      await activeTurn.notificationQueue;
      if (this.closedByHost) return;
      if (activeTurn.notificationError) throw activeTurn.notificationError;
      if (activeTurn.transportInterrupted) {
        this.cumulativeUsage = adapter.cumulativeUsage;
        this.emitStatus('idle', options.operationId);
        return;
      }
      await this.emitEvents(adapter.flush(), options.operationId);
      this.cumulativeUsage = adapter.cumulativeUsage;
      this.emitStatus('idle', options.operationId);
    } catch (error) {
      if (this.closedByHost) return;
      if (this.activeTurn?.transportInterrupted) {
        await this.activeTurn.notificationQueue;
        if (this.activeTurn.notificationError) {
          this.emitStatus('error', options.operationId);
          throw this.activeTurn.notificationError;
        }
        this.cumulativeUsage = this.activeTurn.adapter.cumulativeUsage;
        this.emitStatus('idle', options.operationId);
        return;
      }
      this.emitStatus('error', options.operationId);
      throw error;
    } finally {
      for (const unsubscribe of traceUnsubscribers) unsubscribe();
      this.activeTurn = undefined;
      this.interruptRequested = false;
      this.running = false;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.running) return;
    this.interruptRequested = true;
    const activeTurn = this.activeTurn;
    if (!activeTurn) return;

    activeTurn.interruptRequested = true;
    if (!activeTurn.turnId) return;
    try {
      await this.requestInterrupt(activeTurn);
    } catch (error) {
      if (
        this.activeTurn === activeTurn &&
        activeTurn.transportInterrupted &&
        error instanceof CodexAppServerConnectionError
      ) {
        return;
      }
      throw error;
    }
  }

  close(): void {
    if (this.closedByHost) return;
    this.closedByHost = true;
    this.interruptRequested = true;
    if (this.activeTurn) {
      this.activeTurn.interruptRequested = true;
      if (this.activeTurn.turnId) {
        void this.requestInterrupt(this.activeTurn).catch((error) => {
          console.error('Failed to interrupt Codex turn while closing the session:', error);
        });
      }
      this.interruptActiveTurn();
    }
    this.unsubscribeAll(this.threadUnsubscribers);
    this.unsubscribeAll(this.sessionUnsubscribers);
    this.releaseThread?.();
    this.releaseThread = undefined;
    if (this.lastOperationId) this.emitStatus('closed', this.lastOperationId);
  }

  /**
   * Attaches the native thread, refreshing its shell context before another turn.
   *
   * Call stack:
   *
   * {@link run}
   *   -> ensureThread
   *     -> {@link CodexAppServerClient.connect}
   *     -> {@link CodexAppServerClient.request}
   *     -> {@link attachThread}
   */
  private async ensureThread(): Promise<void> {
    await this.options.client.connect();
    if (this.attached || this.closedByHost) return;

    if (this.threadId) {
      // Once initialize succeeds, an existing native thread must never be replayed via exec.
      this.canFallback = false;
      // NOTICE:
      // Loaded threads ignore config overrides while they still have subscribers.
      // Drop this connection's old subscription before resuming with this run's shell env.
      // Source: `https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L4240`.
      // Remove when Codex supports changing shell environment at the turn boundary.
      // The synchronous native-thread claim prevents another local run being unsubscribed.
      if (this.hasThreadEnv)
        await this.options.client.request('thread/unsubscribe', { threadId: this.threadId });
      if (this.closedByHost) return;
      const params = toThreadResumeParams(this.threadId, this.threadParams);
      const response = await this.options.client.request<ThreadResumeResponse>(
        'thread/resume',
        params,
      );
      if (this.closedByHost) return;
      if (this.hasThreadEnv && response.thread.status?.type !== 'idle') {
        throw new Error(
          'Cannot change Codex thread context while its previous turn is still active',
        );
      }
      await this.attachThread(response.thread.id, response.model);
      return;
    }

    const response = await this.options.client.request<ThreadStartResponse>(
      'thread/start',
      this.threadParams,
    );
    if (this.closedByHost) return;
    const threadId = response?.thread?.id;
    if (!threadId) {
      throw new CodexAppServerConnectionError(
        'Codex app-server returned an incompatible thread/start response',
        { phase: 'thread-start' },
      );
    }

    await this.attachThread(threadId, response.model);
    if (!this.options.threadParams.ephemeral) {
      await this.setThreadName(threadId);
      this.options.onSessionId(threadId);
    }
  }

  private async setThreadName(threadId: string): Promise<void> {
    const name = this.options.threadName?.trim();
    if (!name) return;

    try {
      const params: ThreadNameSetParams = { name, threadId };
      await this.options.client.request<Record<string, never>>('thread/name/set', params);
    } catch (error) {
      console.warn('Failed to set Codex thread name:', { error, threadId });
    }
  }

  /**
   * Claims the native thread and registers its notification and reconnect handlers.
   *
   * Call stack:
   *
   * {@link ensureThread}
   *   -> attachThread
   *     -> {@link CodexAppServerClient.acquireThread}
   *     -> {@link CodexAppServerClient.registerThread}
   */
  private async attachThread(threadId: string, model?: string): Promise<void> {
    this.releaseThread ??= this.options.client.acquireThread(threadId);
    this.threadId = threadId;
    this.attached = true;
    this.canFallback = false;
    if (model) this.updateModel(model);
    if (this.threadUnsubscribers.length > 0) return;

    this.threadUnsubscribers.push(
      this.options.client.subscribe(threadId, (method, params) =>
        this.enqueueNotification(method, params),
      ),
      this.options.client.subscribeServerRequests(threadId, (method) => {
        if (
          method === 'item/commandExecution/requestApproval' ||
          method === 'item/fileChange/requestApproval'
        ) {
          return { decision: 'cancel' };
        }
        throw new Error(`Unsupported Codex app-server request: ${method}`);
      }),
      this.options.client.registerThread(
        threadId,
        toThreadResumeParams(threadId, this.threadParams),
        {
          onResume: (response) => this.handleReconnect(response),
          onResumeError: () => {
            this.attached = false;
          },
        },
      ),
    );
  }

  private async handleReconnect(response: ThreadResumeResponse): Promise<void> {
    if (this.closedByHost) return;
    this.attached = true;
    if (response.model) this.updateModel(response.model);
  }

  private handleDisconnect(): void {
    if (this.closedByHost) return;
    this.attached = false;
    if (this.activeTurn && !this.activeTurn.terminalNotificationReceived) {
      this.interruptActiveTurn();
    }
  }

  private requestInterrupt(activeTurn: ActiveTurn): Promise<void> {
    const threadId = this.threadId;
    const turnId = activeTurn.turnId;
    if (!threadId || !turnId) return Promise.resolve();
    if (activeTurn.interruptRequest) return activeTurn.interruptRequest;

    const params: TurnInterruptParams = { threadId, turnId };
    activeTurn.interruptRequest = this.options.client.request('turn/interrupt', params);
    return activeTurn.interruptRequest;
  }

  private interruptActiveTurn(): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn || activeTurn.transportInterrupted) return;
    activeTurn.transportInterrupted = true;
    activeTurn.notificationQueue = activeTurn.notificationQueue
      .then(() =>
        this.emitEvents(activeTurn.adapter.interruptForTransportFailure(), activeTurn.operationId),
      )
      .catch((error) => this.recordNotificationError(activeTurn, error))
      .finally(activeTurn.resolve);
  }

  private enqueueNotification(method: string, params: unknown): Promise<void> {
    const activeTurn = this.activeTurn;
    if (!activeTurn || !this.isCurrentTurnNotification(method, params, activeTurn)) {
      return Promise.resolve();
    }
    if (method === 'turn/completed') {
      const notification = params as TurnCompletedNotification;
      if (notification.turn.status !== 'inProgress') {
        activeTurn.terminalNotificationReceived = true;
      }
    }

    activeTurn.notificationQueue = activeTurn.notificationQueue
      .then(async () => {
        if (activeTurn.notificationError) return;
        await this.emitEvents(activeTurn.adapter.adapt(method, params), activeTurn.operationId);
        if (method !== 'turn/completed') return;
        const notification = params as TurnCompletedNotification;
        if (activeTurn.turnId && notification.turn.id !== activeTurn.turnId) return;
        if (notification.turn.status !== 'inProgress') activeTurn.resolve();
      })
      .catch((error) => {
        this.recordNotificationError(activeTurn, error);
        activeTurn.resolve();
      });
    return activeTurn.notificationQueue;
  }

  private isCurrentTurnNotification(
    method: string,
    params: unknown,
    activeTurn: ActiveTurn,
  ): boolean {
    if (!isRecord(params)) return false;
    const notificationTurnId =
      method === 'turn/started' || method === 'turn/completed'
        ? isRecord(params.turn)
          ? pickString(params.turn.id)
          : undefined
        : pickString(params.turnId);
    if (method === 'turn/started' && !activeTurn.turnId && notificationTurnId) {
      activeTurn.turnId = notificationTurnId;
    }
    return !activeTurn.turnId || !notificationTurnId || activeTurn.turnId === notificationTurnId;
  }

  private async emitEvents(
    events: ReturnType<CodexAppServerAdapter['flush']>,
    operationId: string,
  ): Promise<void> {
    if (events.length === 0) return;
    await this.options.onEvents(events.map((event) => toStreamEvent(event, operationId)));
  }

  private updateModel(model: string): void {
    this.model = model;
    this.options.onModel?.(model);
  }

  private recordNotificationError(activeTurn: ActiveTurn, error: unknown): void {
    if (activeTurn.notificationError) return;
    activeTurn.notificationError = error instanceof Error ? error : new Error(String(error));
  }

  private emitStatus(state: HeterogeneousAgentRuntimeStatus['state'], operationId: string): void {
    this.options.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: Date.now(),
      operationId,
      sessionId: this.options.sessionId,
      state,
      transport: CODEX_APP_SERVER_TRANSPORT,
    });
  }

  private unsubscribeAll(unsubscribers: Array<() => void>): void {
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  }
}
