import type {
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline, type UploadHeterogeneousImage } from './agentStreamPipeline';

const CLAUDE_SDK_DISALLOWED_TOOLS = ['AskUserQuestion', 'Monitor', 'ScheduleWakeup'] as const;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const INPUT_CLOSE_POLL_MS = 1000;

const readTimeoutMs = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasContentMessage = (value: unknown): value is SDKUserMessage => {
  if (!isObject(value)) return false;
  if (value.type !== 'user') return false;
  return isObject(value.message);
};

export const buildClaudeSdkUserMessageFromStreamJson = (stdinPayload: string): SDKUserMessage => {
  const line = stdinPayload
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);

  if (!line) throw new Error('Claude SDK input payload is empty');

  const parsed = JSON.parse(line) as unknown;
  if (!hasContentMessage(parsed)) {
    throw new Error('Claude SDK input payload is not a user message');
  }

  return {
    ...parsed,
    parent_tool_use_id: parsed.parent_tool_use_id ?? null,
  };
};

const parseClaudeSdkExtraArgs = (
  args: string[],
): Pick<ClaudeAgentSdkOptions, 'effort' | 'extraArgs' | 'model'> => {
  const extraArgs: Record<string, string | null> = {};
  let model: string | undefined;
  let effort: ClaudeAgentSdkOptions['effort'];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const next = args[index + 1];
    const hasValue = next !== undefined && !next.startsWith('-');

    if (key === 'model' && hasValue) {
      model = next;
      index += 1;
      continue;
    }

    if (key === 'effort' && hasValue) {
      effort = next as ClaudeAgentSdkOptions['effort'];
      index += 1;
      continue;
    }

    extraArgs[key] = hasValue ? next : null;
    if (hasValue) index += 1;
  }

  return {
    ...(effort ? { effort } : {}),
    extraArgs: Object.keys(extraArgs).length > 0 ? extraArgs : undefined,
    ...(model ? { model } : {}),
  };
};

interface TrackedTask {
  description?: string;
  lastEventAt: number;
  startedAt: number;
  taskId: string;
  toolUseId?: string;
  type?: string;
}

export type HeterogeneousAgentRuntimeState =
  'starting' | 'running' | 'monitoring' | 'idle' | 'stale' | 'closing' | 'closed' | 'error';

export interface HeterogeneousAgentRuntimeTask {
  description?: string;
  lastEventAt: number;
  startedAt: number;
  taskId: string;
  toolUseId?: string;
  type?: string;
}

export interface HeterogeneousAgentRuntimeStatus {
  activeTasks: HeterogeneousAgentRuntimeTask[];
  idleDeadlineAt?: number;
  lastEventAt: number;
  operationId?: string;
  sessionId: string;
  staleDeadlineAt?: number;
  state: HeterogeneousAgentRuntimeState;
  transport: 'claude-sdk' | 'cli-spawn';
}

export interface ClaudeAgentSdkSessionOptions {
  args: string[];
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  onRawMessage: (line: string) => Promise<void> | void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => Promise<void> | void;
  operationId: string;
  resumeSessionId?: string;
  sessionId: string;
  stdinPayload: string;
  /** Uploader for base64 tool_result images; see `AgentStreamPipelineOptions`. */
  uploadImage?: UploadHeterogeneousImage;
}

export class ClaudeAgentSdkSession {
  private readonly abortController = new AbortController();
  private activeTasks = new Map<string, TrackedTask>();
  private closeInput = false;
  private closeReason: Error | undefined;
  private closedByHost = false;
  private inactivityTimer: NodeJS.Timeout | undefined;
  private lastEventAt = Date.now();
  private pipeline: AgentStreamPipeline;
  private queryHandle: ClaudeAgentSdkQuery | undefined;
  private sawErrorEvent = false;
  private taskNotificationPending = false;

  constructor(private readonly options: ClaudeAgentSdkSessionOptions) {
    this.pipeline = new AgentStreamPipeline({
      agentType: 'claude-code-sdk',
      cwd: options.cwd,
      operationId: options.operationId,
      uploadImage: options.uploadImage,
    });
  }

  async run(): Promise<void> {
    this.emitStatus('starting');
    this.armInactivityTimer();

    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const userMessage = buildClaudeSdkUserMessageFromStreamJson(this.options.stdinPayload);

      this.queryHandle = query({
        options: this.buildQueryOptions(),
        prompt: this.createInputStream(userMessage),
      });

      this.emitStatus('running');

      for await (const message of this.queryHandle) {
        await this.consumeSdkMessage(message);
      }

      await this.flushPipeline();

      if (this.closeReason) throw this.closeReason;
      if (!this.sawErrorEvent) {
        await this.options.onEvents(
          this.pipeline.completeRuntime({
            reason: 'complete',
            transport: 'claude-sdk',
          }),
        );
      }

      this.emitStatus('closed');
    } catch (error) {
      if (this.closedByHost) {
        this.emitStatus('closed');
        return;
      }

      const normalizedError = this.closeReason ?? error;
      this.emitStatus('error');
      throw normalizedError;
    } finally {
      this.clearInactivityTimer();
      this.closeInput = true;
      this.queryHandle = undefined;
    }
  }

  close(): void {
    this.closedByHost = true;
    this.closeInput = true;
    this.emitStatus('closing');
    this.abortController.abort();
    this.queryHandle?.close();
  }

  private buildQueryOptions(): ClaudeAgentSdkOptions {
    const argOptions = parseClaudeSdkExtraArgs(this.options.args);

    return {
      allowDangerouslySkipPermissions: true,
      abortController: this.abortController,
      cwd: this.options.cwd,
      disallowedTools: [...CLAUDE_SDK_DISALLOWED_TOOLS],
      env: this.options.env,
      includePartialMessages: true,
      pathToClaudeCodeExecutable: this.options.commandPath,
      permissionMode: 'bypassPermissions',
      ...(this.options.resumeSessionId ? { resume: this.options.resumeSessionId } : {}),
      ...argOptions,
      stderr: (data) => {
        void this.options.onStderr(data);
      },
    };
  }

  private async *createInputStream(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
    yield message;

    while (!this.closeInput && !this.abortController.signal.aborted) {
      await sleep(INPUT_CLOSE_POLL_MS);
    }
  }

  private async consumeSdkMessage(message: SDKMessage): Promise<void> {
    this.lastEventAt = Date.now();
    this.armInactivityTimer();
    this.updateTaskState(message);

    const line = `${JSON.stringify(message)}\n`;
    await this.options.onRawMessage(line);

    const events = await this.pipeline.push(line);
    this.sawErrorEvent ||= events.some((event) => event.type === 'error');
    await this.options.onEvents(events);

    if (this.pipeline.sessionId) this.options.onSessionId(this.pipeline.sessionId);
    this.maybeCloseInputAfterResult(message);
    this.emitStatus(this.resolveRuntimeState());
  }

  private async flushPipeline(): Promise<void> {
    const events = await this.pipeline.flush();
    this.sawErrorEvent ||= events.some((event) => event.type === 'error');
    await this.options.onEvents(events);
    if (this.pipeline.sessionId) this.options.onSessionId(this.pipeline.sessionId);
  }

  private updateTaskState(message: SDKMessage): void {
    if (message.type !== 'system') return;

    if (message.subtype === 'task_started') {
      this.activeTasks.set(message.task_id, {
        description: message.description,
        lastEventAt: this.lastEventAt,
        startedAt: this.lastEventAt,
        taskId: message.task_id,
        toolUseId: message.tool_use_id,
        type: message.task_type,
      });
      return;
    }

    if (message.subtype === 'task_updated') {
      const task = this.activeTasks.get(message.task_id);
      if (!task) return;

      task.lastEventAt = this.lastEventAt;
      if (message.patch.description) task.description = message.patch.description;
      if (
        message.patch.status &&
        ['completed', 'failed', 'killed'].includes(message.patch.status)
      ) {
        this.activeTasks.delete(message.task_id);
      }
      return;
    }

    if (message.subtype === 'task_progress') {
      const task = this.activeTasks.get(message.task_id);
      if (!task) return;

      task.lastEventAt = this.lastEventAt;
      task.description = message.summary || message.description || task.description;
      return;
    }

    if (message.subtype === 'task_notification') {
      this.taskNotificationPending = true;
      this.activeTasks.delete(message.task_id);
    }
  }

  private maybeCloseInputAfterResult(message: SDKMessage): void {
    if (message.type !== 'result') return;

    if (message.origin?.kind === 'task-notification') {
      this.taskNotificationPending = false;
      this.closeInput = true;
      return;
    }

    if (this.activeTasks.size === 0 && !this.taskNotificationPending) {
      this.closeInput = true;
    }
  }

  private resolveRuntimeState(): HeterogeneousAgentRuntimeState {
    if (this.closeInput && this.activeTasks.size === 0) return 'idle';
    if (this.activeTasks.size > 0 || this.taskNotificationPending) return 'monitoring';
    return 'running';
  }

  private emitStatus(state: HeterogeneousAgentRuntimeState): void {
    const now = Date.now();
    const timeoutMs = this.inactivityTimeoutMs;
    const tasks: HeterogeneousAgentRuntimeTask[] = [...this.activeTasks.values()].map((task) => ({
      description: task.description,
      lastEventAt: task.lastEventAt,
      startedAt: task.startedAt,
      taskId: task.taskId,
      toolUseId: task.toolUseId,
      type: task.type,
    }));

    this.options.onRuntimeStatus({
      activeTasks: tasks,
      idleDeadlineAt: state === 'idle' ? now + timeoutMs : undefined,
      lastEventAt: this.lastEventAt,
      operationId: this.options.operationId,
      sessionId: this.options.sessionId,
      staleDeadlineAt:
        state === 'running' || state === 'monitoring' ? this.lastEventAt + timeoutMs : undefined,
      state,
      transport: 'claude-sdk',
    });
  }

  private get inactivityTimeoutMs(): number {
    return readTimeoutMs(
      'LOBE_CLAUDE_CODE_SDK_INACTIVITY_TIMEOUT_MS',
      DEFAULT_INACTIVITY_TIMEOUT_MS,
    );
  }

  private armInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.closeReason = new Error(
        `Claude SDK session produced no messages for ${this.inactivityTimeoutMs}ms`,
      );
      this.emitStatus('stale');
      this.close();
    }, this.inactivityTimeoutMs);
    this.inactivityTimer.unref?.();
  }

  private clearInactivityTimer(): void {
    if (!this.inactivityTimer) return;

    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = undefined;
  }
}
