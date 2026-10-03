import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { CodexForkTarget } from '@lobechat/types';
import { isRecord, pickString } from '@lobechat/utils/object';

import { CodexAppServerAdapter } from '../adapters/codexAppServer';
import type { HeterogeneousAgentRuntimeStatus } from '../spawn/claudeAgentSdkSession';
import { toStreamEvent } from '../spawn/streamEvent';
import type { UsageData } from '../types';
import type { CodexApprovalDecision } from './CodexApprovalBridge';
import { CodexApprovalBridge } from './CodexApprovalBridge';
import type { CodexAppServerClient } from './CodexAppServerClient';
import { CodexAppServerConnectionError } from './CodexAppServerClient';
import { withCodexThreadEnv } from './environment';
import type {
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  SandboxMode,
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

const toThreadForkParams = (threadId: string, lastTurnId: string, params: ThreadStartParams) => {
  const forkParams = { ...params };
  delete forkParams.personality;
  delete forkParams.serviceName;
  delete forkParams.sessionStartSource;
  return { ...forkParams, lastTurnId, threadId };
};

interface ActiveTurn {
  adapter: CodexAppServerAdapter;
  approvalBridge: CodexApprovalBridge;
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

/** Input and trace callbacks for one native Codex turn. */
export interface CodexThreadTurnOptions {
  /** Current run provenance for shell tools; credentials remain in the process environment. */
  env?: Partial<NodeJS.ProcessEnv>;
  /** Prepare input after the native history boundary is known; true means no retained history. */
  input: UserInput[] | ((isNewSession: boolean) => Promise<UserInput[]>);
  /** Receives raw app-server messages for this turn's trace. */
  onRawMessage: (line: string) => Promise<void> | void;
  /** Operation receiving this turn's events and runtime status. */
  operationId: string;
}

export interface CodexThreadSessionOptions {
  /** Legacy full-access sessions may fall back to `codex exec` before a native thread exists. */
  allowExecFallback?: boolean;
  client: CodexAppServerClient;
  /** Fork at a native turn boundary, never at a UI message offset. */
  forkTarget?: CodexForkTarget;
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

/**
 * A persistent Codex thread state machine backed by the shared app-server client.
 *
 * Use when:
 * - Running successive turns on a resumed, forked, or newly created native thread.
 * Expects:
 * - One active turn per session, with native boundaries supplied for forks.
 * Returns:
 * - Stream events and completion while preserving the resulting thread for reuse.
 *
 * Call stack:
 *
 * sendPromptWithCodexAppServer
 *   -> {@link CodexThreadSession.run}
 *     -> {@link CodexThreadSession.ensureThread}
 *       -> {@link CodexAppServerClient.request}
 */
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
  private isNewThread = false;
  private pendingForkTarget?: CodexForkTarget;
  private lastOperationId?: string;
  private model?: string;
  private running = false;
  private readonly sessionUnsubscribers: Array<() => void> = [];
  private threadId?: string;
  private readonly threadUnsubscribers: Array<() => void> = [];

  constructor(private readonly options: CodexThreadSessionOptions) {
    this.canFallback =
      options.allowExecFallback !== false && !options.initialThreadId && !options.forkTarget;
    this.cumulativeUsage = options.initialCumulativeUsage;
    this.model = options.initialModel;
    this.pendingForkTarget = options.forkTarget;
    this.threadId = options.forkTarget?.threadId ?? options.initialThreadId;
    this.threadParams = options.threadParams;
    // A fork only reads its source; ownership belongs to the new child thread.
    if (this.threadId && !this.pendingForkTarget)
      this.releaseThread = options.client.acquireThread(this.threadId);
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
      const input =
        typeof options.input === 'function' ? await options.input(this.isNewThread) : options.input;
      if (this.closedByHost) return;

      const adapter = new CodexAppServerAdapter({
        initialCumulativeUsage: this.cumulativeUsage,
        initialModel: this.model,
        sessionId: threadId,
      });
      let resolveTurn!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveTurn = resolve;
      });
      const activeTurn: ActiveTurn = {
        adapter,
        approvalBridge: new CodexApprovalBridge({
          emit: (event) => this.options.onEvents([event]),
          operationId: options.operationId,
        }),
        completion,
        interruptRequested: this.interruptRequested,
        notificationQueue: Promise.resolve(),
        operationId: options.operationId,
        resolve: resolveTurn,
        terminalNotificationReceived: false,
        transportInterrupted: false,
      };
      this.activeTurn = activeTurn;

      const turnParams: TurnStartParams = { input, threadId };
      this.canFallback = false;
      const turn = await this.options.client.request<TurnStartResponse>('turn/start', turnParams);
      activeTurn.turnId = turn?.turn?.id;
      if (!activeTurn.turnId) throw new Error('Codex app-server returned no turn id');
      this.isNewThread = false;
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
      this.activeTurn?.approvalBridge.cancelAll();
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
    activeTurn.approvalBridge.cancelAll();
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
      this.activeTurn.approvalBridge.cancelAll();
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

    if (this.threadId && this.pendingForkTarget) {
      this.canFallback = false;
      const sourceThreadId = this.threadId;
      const source = await this.options.client.request<Pick<ThreadResumeResponse, 'thread'>>(
        'thread/read',
        { includeTurns: true, threadId: sourceThreadId },
      );
      if (this.closedByHost) return;

      const { position, turnId } = this.pendingForkTarget;
      const sourceIndex = source.thread.turns.findIndex((turn) => turn.id === turnId);
      if (sourceIndex < 0) {
        throw new Error(`Cannot find Codex turn ${turnId} in the source thread`);
      }
      if (source.thread.turns[sourceIndex].status === 'inProgress') {
        throw new Error('Cannot fork a Codex turn while it is running');
      }
      const keepTurns = sourceIndex + (position === 'after' ? 1 : 0);

      if (keepTurns === 0) {
        const response = await this.options.client.request<ThreadStartResponse>(
          'thread/start',
          this.threadParams,
        );
        if (this.closedByHost) return;
        this.assertPermissionProfile(response);
        // Editing the first turn retains no history, so source usage and introductions cannot carry over.
        this.cumulativeUsage = undefined;
        this.isNewThread = true;
        await this.attachThread(response.thread.id, response.model);
      } else {
        const lastTurnId = source.thread.turns[keepTurns - 1]?.id;
        if (!lastTurnId) throw new Error('Codex app-server returned a turn without an id');
        const response = await this.options.client.request<ThreadStartResponse>(
          'thread/fork',
          toThreadForkParams(sourceThreadId, lastTurnId, this.threadParams),
        );
        if (this.closedByHost) return;
        this.assertPermissionProfile(response);
        await this.attachThread(response.thread.id, response.model);
      }

      this.pendingForkTarget = undefined;
      const forkedThreadId = this.threadId;
      if (!forkedThreadId) throw new Error('Codex app-server returned no forked thread id');
      await this.setThreadName(forkedThreadId);
      this.options.onSessionId(forkedThreadId);
      return;
    }

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
      this.assertPermissionProfile(response);
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
    this.assertPermissionProfile(response);

    this.isNewThread = true;
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
      this.options.client.subscribeServerRequests(threadId, (method, params) =>
        this.handleServerRequest(method, params),
      ),
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
    this.assertPermissionProfile(response);
    this.attached = true;
    if (response.model) this.updateModel(response.model);
  }

  private handleDisconnect(): void {
    if (this.closedByHost) return;
    this.attached = false;
    this.activeTurn?.approvalBridge.cancelAll();
    if (this.activeTurn && !this.activeTurn.terminalNotificationReceived) {
      this.interruptActiveTurn();
    }
  }

  resolveApproval(
    operationId: string,
    interventionId: string,
    decision: CodexApprovalDecision,
  ): boolean {
    const activeTurn = this.activeTurn;
    if (!activeTurn || activeTurn.operationId !== operationId) return false;
    return activeTurn.approvalBridge.resolve(interventionId, decision);
  }

  private async handleServerRequest(
    method: string,
    params: unknown,
  ): Promise<CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse> {
    const activeTurn = this.activeTurn;
    if (!activeTurn) return { decision: 'cancel' };
    await activeTurn.notificationQueue;
    if (
      this.closedByHost ||
      activeTurn !== this.activeTurn ||
      !isRecord(params) ||
      params.threadId !== this.threadId ||
      (activeTurn.turnId && params.turnId !== activeTurn.turnId)
    )
      return { decision: 'cancel' };

    if (method === 'item/commandExecution/requestApproval') {
      const request = params as CommandExecutionRequestApprovalParams;
      const decision = await activeTurn.approvalBridge.request({
        apiName: 'command_execution',
        arguments: request,
        interventionId: request.approvalId ?? request.itemId,
        toolCallId: request.itemId,
      });
      return { decision };
    }
    if (method === 'item/fileChange/requestApproval') {
      const request = params as FileChangeRequestApprovalParams;
      const decision = await activeTurn.approvalBridge.request({
        apiName: 'file_change',
        arguments: request,
        interventionId: request.itemId,
        toolCallId: request.itemId,
      });
      return { decision };
    }
    throw new Error(`Unsupported Codex app-server request: ${method}`);
  }

  private assertPermissionProfile(response: ThreadResumeResponse | ThreadStartResponse): void {
    const expected = this.options.threadParams;
    const sandboxTypes: Record<SandboxMode, string> = {
      'danger-full-access': 'dangerFullAccess',
      'read-only': 'readOnly',
      'workspace-write': 'workspaceWrite',
    };
    const expectedSandboxType = expected.sandbox ? sandboxTypes[expected.sandbox] : undefined;
    const constrainedPreset = expected.config?.['sandbox_workspace_write.network_access'] === false;
    const expandedScope =
      constrainedPreset &&
      ((response.sandbox.type === 'readOnly' && response.sandbox.networkAccess) ||
        (response.sandbox.type === 'workspaceWrite' &&
          (response.sandbox.networkAccess ||
            !response.sandbox.excludeTmpdirEnvVar ||
            !response.sandbox.excludeSlashTmp ||
            response.sandbox.writableRoots.some((root) => root !== response.cwd))));
    if (
      expandedScope ||
      response.approvalPolicy !== expected.approvalPolicy ||
      response.approvalsReviewer !== expected.approvalsReviewer ||
      (expectedSandboxType && response.sandbox?.type !== expectedSandboxType)
    ) {
      throw new CodexAppServerConnectionError(
        'Codex app-server did not apply the requested permission profile',
        { phase: 'thread-start' },
      );
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
