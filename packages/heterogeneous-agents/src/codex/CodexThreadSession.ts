import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { CodexCollaborationMode } from '@lobechat/types';
import { isCodexCollaborationMode } from '@lobechat/types';
import { isRecord, pickString } from '@lobechat/utils/object';

import { CodexAppServerAdapter } from '../adapters/codexAppServer';
import type { AskUserBridge, InterventionAnswer } from '../askUser';
import { COLLABORATION_MODE_PHASE, type CollaborationModeReportData } from '../codexPlanMode';
import type { HeterogeneousAgentRuntimeStatus } from '../spawn/claudeAgentSdkSession';
import { toStreamEvent } from '../spawn/streamEvent';
import type { UsageData } from '../types';
import {
  codexAsyncAnswers,
  formatCodexAsyncReplies,
  readCodexAsyncQuestion,
} from './asyncUserInput';
import type { CodexAppServerClient } from './CodexAppServerClient';
import { CodexAppServerConnectionError, CodexAppServerRpcError } from './CodexAppServerClient';
import type { CodexRunProvenance } from './environment';
import { isSameCodexRunProvenance, withCodexThreadEnv } from './environment';
import type {
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadUnsubscribeParams,
  ThreadUnsubscribeResponse,
  TurnCompletedNotification,
  TurnInterruptParams,
  TurnStartParams,
  TurnStartResponse,
  UserInput,
} from './protocol';
import type { CollaborationMode } from './protocol/experimental/CollaborationMode';
import type { ReasoningEffort } from './protocol/experimental/ReasoningEffort';
import type { ThreadSettingsUpdatedNotification } from './protocol/experimental/v2/ThreadSettingsUpdatedNotification';
import type { ThreadSettingsUpdateParams } from './protocol/experimental/v2/ThreadSettingsUpdateParams';
import {
  codexUserInputArguments,
  codexUserInputResponse,
  parseCodexUserInput,
} from './requestUserInput';

const CODEX_APP_SERVER_TRANSPORT = 'codex-app-server' as const;
/** An interrupted turn settled within 250 ms in probes; this bounds slow tool teardown. */
const RESUME_SETTLE_DELAY_MS = 200;
const RESUME_SETTLE_TIMEOUT_MS = 10_000;

/** `turn/start.collaborationMode` is EXPERIMENTAL in 0.169 and absent from the stable params. */
type ExperimentalTurnStartParams = TurnStartParams & { collaborationMode?: CollaborationMode };

const toThreadResumeParams = (threadId: string, params: ThreadStartParams): ThreadResumeParams => {
  const resumeParams = { ...params };
  delete resumeParams.ephemeral;
  delete resumeParams.serviceName;
  delete resumeParams.sessionStartSource;
  delete resumeParams.threadSource;
  return { ...resumeParams, threadId };
};

type AsyncQuestion = NonNullable<ReturnType<typeof readCodexAsyncQuestion>>;

interface ActiveTurn {
  adapter: CodexAppServerAdapter;
  askUserBridge?: AskUserBridge;
  asyncQuestions: Map<string, { answer: Promise<InterventionAnswer>; request: AsyncQuestion }>;
  completion: Promise<void>;
  deferredCompletion?: TurnCompletedNotification;
  interruptRequest?: Promise<void>;
  interruptRequested: boolean;
  notificationError?: Error;
  notificationQueue: Promise<void>;
  operationId: string;
  resolve: () => void;
  synchronousQuestions: Set<string>;
  terminalNotificationReceived: boolean;
  transportInterrupted: boolean;
  turnId?: string;
}

/** `turn/steer` (app-server v2): add input to the active turn, which must still be `expectedTurnId`. */
interface TurnSteerParams {
  clientUserMessageId?: string | null;
  expectedTurnId: string;
  input: TurnStartParams['input'];
  threadId: string;
}

/** How a steer ended: taken by the active turn, or left for a turn of its own. */
export type CodexSteerOutcome = 'accepted' | 'rejected';

interface ThreadNameSetParams {
  name: string;
  threadId: string;
}

export interface CodexThreadTurnOptions {
  askUserBridge?: AskUserBridge;
  /**
   * Codex Plan switch (Better Coding Experience): the collaboration mode every
   * native turn of this run sends. Omitted sends none, exactly as before. Codex
   * keeps the mode on the thread, so it stays until a turn sends another.
   */
  collaborationMode?: CodexCollaborationMode;
  input: UserInput[];
  onRawMessage: (line: string) => Promise<void> | void;
  operationId: string;
  /** IDs exposed to this run's shell tools; omitted keeps the caller's thread config. */
  provenance?: CodexRunProvenance;
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
  private provenance?: CodexRunProvenance;
  private releaseThread?: () => void;
  private threadParams: ThreadStartParams;
  private canFallback: boolean;
  private closedByHost = false;
  private cumulativeUsage?: UsageData;
  private interruptRequested = false;
  private lastOperationId?: string;
  private model?: string;
  private effort?: ReasoningEffort | null;
  /** The mode this run's turns send; a mid-run switch changes it for the next turn. */
  private collaborationMode?: CodexCollaborationMode;
  /**
   * Modes sent since the last `turn/start`, oldest first, that Codex has not
   * acknowledged yet. A `thread/settings/updated` naming one of them answers
   * that request (and supersedes the older ones), not the latest pick.
   */
  private pendingModeRequests: CodexCollaborationMode[] = [];
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
    this.sessionUnsubscribers.push(
      options.client.acquireConsumer(),
      options.client.onDisconnect(() => this.handleDisconnect()),
    );
  }

  get canFallbackToExec(): boolean {
    return this.canFallback;
  }

  async run(options: CodexThreadTurnOptions): Promise<void> {
    if (this.closedByHost) throw new Error('Codex thread session is closed');
    if (this.running) throw new Error('Codex thread already has a running turn');

    this.running = true;
    this.interruptRequested = false;
    this.lastOperationId = options.operationId;
    this.collaborationMode = options.collaborationMode;
    this.emitStatus('starting', options.operationId);
    const traceUnsubscribers: Array<() => void> = [];

    try {
      if (options.provenance) {
        if (!this.provenance || !isSameCodexRunProvenance(this.provenance, options.provenance)) {
          // Re-resume with the new IDs; this also drops reconnect params queued with the old ones.
          this.unsubscribeAll(this.threadUnsubscribers);
          this.attached = false;
        }
        this.provenance = options.provenance;
        this.threadParams = withCodexThreadEnv(this.options.threadParams, options.provenance);
      }
      await this.ensureThread();
      if (this.closedByHost) return;
      const threadId = this.threadId;
      if (!threadId) throw new Error('Codex thread is not attached');
      traceUnsubscribers.push(this.options.client.onRawMessage(threadId, options.onRawMessage));

      let input: UserInput[] | undefined = options.input;
      let stepIndex = 0;
      while (input && !this.closedByHost) {
        const result = await this.runNativeTurn(options, threadId, input, stepIndex);
        input = result?.input;
        stepIndex = result?.stepIndex ?? 0;
      }
      if (!this.closedByHost) this.emitStatus('idle', options.operationId);
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
      this.activeTurn?.askUserBridge?.cancelAll('session_ended');
      for (const unsubscribe of traceUnsubscribers) unsubscribe();
      this.activeTurn = undefined;
      this.interruptRequested = false;
      this.running = false;
    }
  }

  private async runNativeTurn(
    options: CodexThreadTurnOptions,
    threadId: string,
    input: UserInput[],
    stepIndex: number,
  ): Promise<{ input: UserInput[]; stepIndex: number } | undefined> {
    const adapter = new CodexAppServerAdapter({
      initialCumulativeUsage: this.cumulativeUsage,
      initialModel: this.model,
      initialStepIndex: stepIndex,
      // An ephemeral thread cannot be resumed, so it is never reported as the session.
      sessionId: this.options.threadParams.ephemeral ? undefined : threadId,
    });
    let resolveTurn!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    const activeTurn: ActiveTurn = {
      adapter,
      askUserBridge: options.askUserBridge,
      asyncQuestions: new Map(),
      completion,
      interruptRequested: this.interruptRequested,
      notificationQueue: Promise.resolve(),
      operationId: options.operationId,
      resolve: resolveTurn,
      synchronousQuestions: new Set(),
      terminalNotificationReceived: false,
      transportInterrupted: false,
    };
    this.activeTurn = activeTurn;

    const collaborationMode = this.collaborationModeParams(this.collaborationMode);
    // Each turn states its mode afresh: earlier unanswered requests are moot.
    this.pendingModeRequests = collaborationMode ? [collaborationMode.mode] : [];
    const turnParams: ExperimentalTurnStartParams = {
      input,
      threadId,
      ...(collaborationMode && { collaborationMode }),
    };
    this.canFallback = false;
    const turn = await this.options.client.request<TurnStartResponse>('turn/start', turnParams);
    activeTurn.turnId = turn?.turn?.id;
    if (!activeTurn.turnId) throw new Error('Codex app-server returned no turn id');
    if (activeTurn.interruptRequested || this.closedByHost) await this.requestInterrupt(activeTurn);
    if (this.closedByHost) return;
    if (stepIndex === 0) this.emitStatus('running', options.operationId);

    await activeTurn.completion;
    await activeTurn.notificationQueue;
    if (this.closedByHost) return;
    if (activeTurn.notificationError) throw activeTurn.notificationError;
    const continuation = activeTurn.deferredCompletion
      ? await this.finishAsyncQuestions(activeTurn, activeTurn.deferredCompletion)
      : undefined;
    if (!activeTurn.transportInterrupted) {
      await this.emitEvents(adapter.flush(), options.operationId);
    }
    this.cumulativeUsage = adapter.cumulativeUsage;
    return continuation
      ? {
          input: [{ text: continuation, text_elements: [], type: 'text' }],
          stepIndex: adapter.nextStepIndex,
        }
      : undefined;
  }

  /**
   * Add a user message to the running turn (`turn/steer`). The model reads it
   * at its next step; the app-server reports it back as a `userMessage` item
   * carrying `clientUserMessageId`. A turn that cannot take input (none
   * running, a review or compaction turn, a different turn than the one
   * started here) refuses it, and the caller sends it as a turn of its own.
   */
  async steer(
    input: TurnStartParams['input'],
    clientUserMessageId: string,
  ): Promise<CodexSteerOutcome> {
    const activeTurn = this.activeTurn;
    const threadId = this.threadId;
    if (
      !activeTurn?.turnId ||
      !threadId ||
      activeTurn.terminalNotificationReceived ||
      activeTurn.interruptRequested ||
      this.closedByHost
    )
      return 'rejected';

    try {
      const params: TurnSteerParams = {
        clientUserMessageId,
        expectedTurnId: activeTurn.turnId,
        input,
        threadId,
      };
      await this.options.client.request('turn/steer', params);
      return 'accepted';
    } catch (error) {
      // A definite refusal (`activeTurnNotSteerable`, a turn mismatch) was not stored.
      if (error instanceof CodexAppServerRpcError) return 'rejected';
      throw error;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.running) return;
    this.interruptRequested = true;
    const activeTurn = this.activeTurn;
    if (!activeTurn) return;

    activeTurn.interruptRequested = true;
    activeTurn.askUserBridge?.cancelAll('session_ended');
    if (!activeTurn.turnId || activeTurn.terminalNotificationReceived) return;
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
      if (this.activeTurn.turnId && !this.activeTurn.terminalNotificationReceived) {
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

  private async ensureThread(): Promise<void> {
    await this.options.client.connect();
    if (this.attached || this.closedByHost) return;

    if (this.threadId) {
      // Once initialize succeeds, an existing native thread must never be replayed via exec.
      this.canFallback = false;
      // Claimed before unsubscribing, which would otherwise cut off another local owner.
      this.releaseThread ??= this.options.client.acquireThread(this.threadId);
      const response = this.provenance
        ? await this.resumeWithShellEnv(this.threadId)
        : await this.options.client.request<ThreadResumeResponse>(
            'thread/resume',
            toThreadResumeParams(this.threadId, this.threadParams),
          );
      if (!response || this.closedByHost) return;
      await this.attachThread(response.thread.id, response.model, response.reasoningEffort);
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

    await this.attachThread(threadId, response.model, response.reasoningEffort);
    if (!this.options.threadParams.ephemeral) {
      await this.setThreadName(threadId);
      this.options.onSessionId(threadId);
    }
  }

  /**
   * Resumes a thread so the next turn's shell sees this run's provenance.
   *
   * NOTICE:
   * Codex has no per-turn shell environment, and `thread/resume` ignores config overrides for a
   * thread that still has subscribers or a running turn. Unsubscribing lets an idle thread reload
   * with the new config; a turn interrupted by a closed session can stay `active` for a moment,
   * so retry until it settles. Verified against `codex-cli 0.160.1`; source:
   * `https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server/src/request_processors/thread_processor.rs#L4336-L4386`.
   * Remove when `turn/start` can set the shell environment.
   */
  private async resumeWithShellEnv(threadId: string): Promise<ThreadResumeResponse | undefined> {
    const deadline = Date.now() + RESUME_SETTLE_TIMEOUT_MS;
    while (true) {
      await this.options.client.request<ThreadUnsubscribeResponse>('thread/unsubscribe', {
        threadId,
      } satisfies ThreadUnsubscribeParams);
      if (this.closedByHost) return;
      const response = await this.options.client.request<ThreadResumeResponse>(
        'thread/resume',
        toThreadResumeParams(threadId, this.threadParams),
      );
      if (this.closedByHost || response.thread.status?.type !== 'active') return response;
      if (Date.now() >= deadline) {
        throw new Error(
          'Codex is still finishing the previous turn in this conversation. Try again once it stops.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, RESUME_SETTLE_DELAY_MS));
      if (this.closedByHost) return;
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

  private async attachThread(
    threadId: string,
    model?: string,
    effort?: ReasoningEffort | null,
  ): Promise<void> {
    this.releaseThread ??= this.options.client.acquireThread(threadId);
    this.threadId = threadId;
    this.attached = true;
    this.canFallback = false;
    if (model) this.updateModel(model);
    // The effort the thread resolved from this run's config (a pick made in
    // LobeHub reaches it here), which a collaboration mode must carry along.
    if (effort !== undefined) this.effort = effort;
    if (this.threadUnsubscribers.length > 0) return;

    this.threadUnsubscribers.push(
      this.options.client.subscribe(threadId, (method, params) =>
        this.enqueueNotification(method, params),
      ),
      this.options.client.subscribeServerRequests(threadId, (method, params) => {
        if (
          method === 'item/commandExecution/requestApproval' ||
          method === 'item/fileChange/requestApproval'
        ) {
          return { decision: 'cancel' };
        }
        if (method === 'item/tool/requestUserInput') return this.requestUserInput(params);
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

  /**
   * The Plan switch flipped while this run goes: Codex takes the mode from its
   * next turn (`thread/settings/update` never changes the turn in flight), and
   * this run's own next turn — a continuation after async answers — sends it too.
   */
  async setCollaborationMode(mode: CodexCollaborationMode): Promise<void> {
    this.collaborationMode = mode;
    if (!this.running || !this.attached || !this.threadId || this.closedByHost) return;
    const collaborationMode = this.collaborationModeParams(mode);
    if (!collaborationMode) return;
    this.pendingModeRequests.push(mode);
    await this.options.client.request('thread/settings/update', {
      collaborationMode,
      threadId: this.threadId,
    } satisfies ThreadSettingsUpdateParams);
  }

  /**
   * The `collaborationMode` for `mode`, carrying the thread's own model and
   * effort (`developer_instructions: null` keeps the mode's built-in
   * instructions; the thread's developer instructions stay in force, verified
   * on codex-cli 0.169.0). Undefined without a mode, or before the thread
   * reported its model.
   */
  private collaborationModeParams(
    mode: CodexCollaborationMode | undefined,
  ): CollaborationMode | undefined {
    if (!mode || !this.model) return;
    return {
      mode,
      settings: {
        developer_instructions: null,
        model: this.model,
        reasoning_effort: this.effort ?? null,
      },
    };
  }

  /**
   * Codex reports the thread's mode after `turn/start` set it, or after a
   * mid-run switch (it only reports a change). The report carries the request
   * it answers, so the topic follows Codex only where the two disagree. A
   * notification naming a pending request acknowledges that one: with Plan
   * flipped on and back off before Codex answered, its `plan` answers the
   * first flip and must not read as Codex refusing the second.
   */
  private handleThreadSettingsUpdated(
    activeTurn: ActiveTurn,
    params: ThreadSettingsUpdatedNotification,
  ): Promise<void> {
    const mode = params?.threadSettings?.collaborationMode?.mode;
    if (params?.threadId !== this.threadId || !this.collaborationMode) return Promise.resolve();
    if (!isCodexCollaborationMode(mode)) return Promise.resolve();
    const acknowledged = this.pendingModeRequests.indexOf(mode);
    const requested = acknowledged >= 0 ? mode : this.collaborationMode;
    if (acknowledged >= 0) this.pendingModeRequests.splice(0, acknowledged + 1);
    const data: CollaborationModeReportData = {
      collaborationMode: mode,
      phase: COLLABORATION_MODE_PHASE,
      requested,
    };
    activeTurn.notificationQueue = activeTurn.notificationQueue.then(() =>
      this.options.onEvents([
        toStreamEvent(
          { data, stepIndex: 0, timestamp: Date.now(), type: 'step_complete' },
          activeTurn.operationId,
        ),
      ]),
    );
    return activeTurn.notificationQueue;
  }

  private async handleReconnect(response: ThreadResumeResponse): Promise<void> {
    if (this.closedByHost) return;
    this.attached = true;
    if (response.model) this.updateModel(response.model);
    if (response.reasoningEffort !== undefined) this.effort = response.reasoningEffort;
  }

  private async requestUserInput(params: unknown) {
    const request = parseCodexUserInput(params);
    const activeTurn = this.activeTurn;
    const bridge = activeTurn?.askUserBridge;
    if (
      !activeTurn ||
      !bridge ||
      bridge.operationId !== activeTurn.operationId ||
      request.threadId !== this.threadId ||
      request.turnId !== activeTurn.turnId ||
      activeTurn.terminalNotificationReceived ||
      activeTurn.interruptRequested
    )
      throw new Error('Codex user input has no matching active operation');

    const args = codexUserInputArguments(request);
    // Serialize visible tool events with native notifications, but never put
    // the human wait on that queue: interrupts and nonblocking turns must flow.
    activeTurn.notificationQueue = activeTurn.notificationQueue.then(() =>
      this.emitEvents(
        activeTurn.adapter.startUserInput(request.itemId, args),
        activeTurn.operationId,
      ),
    );
    await activeTurn.notificationQueue;
    if (
      activeTurn.interruptRequested ||
      activeTurn.terminalNotificationReceived ||
      activeTurn.transportInterrupted
    )
      return { answers: {} };
    activeTurn.synchronousQuestions.add(request.itemId);
    const answer = await bridge
      .pending(
        { arguments: args, toolCallId: request.itemId },
        request.autoResolutionMs ? { timeoutMs: request.autoResolutionMs } : {},
      )
      .finally(() => activeTurn.synchronousQuestions.delete(request.itemId));
    activeTurn.notificationQueue = activeTurn.notificationQueue.then(() =>
      this.emitEvents(
        activeTurn.adapter.completeUserInput(request.itemId, answer),
        activeTurn.operationId,
      ),
    );
    await activeTurn.notificationQueue;
    return codexUserInputResponse(request, answer);
  }

  private handleDisconnect(): void {
    if (this.closedByHost) return;
    this.attached = false;
    if (
      this.activeTurn &&
      (!this.activeTurn.terminalNotificationReceived || this.activeTurn.asyncQuestions.size > 0)
    ) {
      this.interruptActiveTurn();
    }
  }

  private requestInterrupt(activeTurn: ActiveTurn): Promise<void> {
    const threadId = this.threadId;
    const turnId = activeTurn.turnId;
    if (!threadId || !turnId || activeTurn.terminalNotificationReceived) return Promise.resolve();
    if (activeTurn.interruptRequest) return activeTurn.interruptRequest;

    const params: TurnInterruptParams = { threadId, turnId };
    activeTurn.interruptRequest = this.options.client.request('turn/interrupt', params);
    return activeTurn.interruptRequest;
  }

  private interruptActiveTurn(): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn || activeTurn.transportInterrupted) return;
    activeTurn.transportInterrupted = true;
    activeTurn.askUserBridge?.cancelAll('session_ended');
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
    if (method === 'thread/settings/updated') {
      return this.handleThreadSettingsUpdated(
        activeTurn,
        params as ThreadSettingsUpdatedNotification,
      );
    }
    if (method === 'turn/completed') {
      const notification = params as TurnCompletedNotification;
      if (notification.turn.status !== 'inProgress') {
        activeTurn.terminalNotificationReceived = true;
        for (const id of activeTurn.synchronousQuestions) {
          activeTurn.askUserBridge?.cancel(id, 'session_ended');
        }
      }
    }

    activeTurn.notificationQueue = activeTurn.notificationQueue
      .then(async () => {
        if (activeTurn.notificationError) return;
        if (method === 'item/completed' && (await this.startAsyncQuestion(activeTurn, params)))
          return;
        if (method === 'turn/completed') {
          const notification = params as TurnCompletedNotification;
          if (
            notification.turn.status === 'completed' &&
            activeTurn.asyncQuestions.size > 0 &&
            !activeTurn.transportInterrupted
          ) {
            activeTurn.deferredCompletion = notification;
            activeTurn.resolve();
            return;
          }
          if (notification.turn.status !== 'inProgress') {
            activeTurn.askUserBridge?.cancelAll('session_ended');
          }
        }
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

  private async startAsyncQuestion(activeTurn: ActiveTurn, params: unknown): Promise<boolean> {
    const bridge = activeTurn.askUserBridge;
    if (!bridge || bridge.operationId !== activeTurn.operationId) return false;
    const request = readCodexAsyncQuestion(params);
    if (!request) return false;
    if (activeTurn.asyncQuestions.has(request.itemId)) return true;
    if (activeTurn.interruptRequested || activeTurn.transportInterrupted) return false;

    const { itemId } = request;
    const args = codexUserInputArguments(request);
    await this.emitEvents(activeTurn.adapter.startUserInput(itemId, args), activeTurn.operationId);
    if (activeTurn.interruptRequested || activeTurn.transportInterrupted) return true;

    const answer = bridge.pending({ arguments: args, toolCallId: itemId }).catch((error) => {
      this.recordNotificationError(activeTurn, error);
      return { cancelled: true };
    });
    activeTurn.asyncQuestions.set(itemId, { answer, request });
    return true;
  }

  private async finishAsyncQuestions(
    activeTurn: ActiveTurn,
    notification: TurnCompletedNotification,
  ): Promise<string | undefined> {
    const { adapter, asyncQuestions, operationId } = activeTurn;
    // Codex completes its native turn while the LobeHub operation is still collecting answers.
    // Continue the same thread only after that native turn has settled.
    const answers = await Promise.all(
      [...asyncQuestions.values()].map(async ({ answer, request }) => ({
        answer: await answer,
        request,
      })),
    );
    if (activeTurn.notificationError) throw activeTurn.notificationError;
    if (this.closedByHost || activeTurn.transportInterrupted) {
      await activeTurn.notificationQueue;
      return;
    }
    const replies = [];
    for (const { answer, request } of answers) {
      await this.emitEvents(adapter.completeUserInput(request.itemId, answer), operationId);
      replies.push(...codexAsyncAnswers(request, answer));
    }

    const turnEnded = ({ type }: { type: string }) =>
      type === 'agent_runtime_end' || type === 'visible_output_end';
    const events = adapter.adapt('turn/completed', notification);
    await this.emitEvents(
      events.filter((event) => !turnEnded(event)),
      operationId,
    );
    if (!activeTurn.interruptRequested && !activeTurn.transportInterrupted && replies.length > 0) {
      return formatCodexAsyncReplies(replies);
    }
    await this.emitEvents(events.filter(turnEnded), operationId);
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
