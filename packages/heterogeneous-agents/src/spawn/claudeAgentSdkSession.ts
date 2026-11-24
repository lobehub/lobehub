import { type ChildProcess } from 'node:child_process';

import type {
  Options as ClaudeAgentSdkOptions,
  PermissionResult,
  Query as ClaudeAgentSdkQuery,
  SDKMessage,
  SDKUserMessage,
  SpawnedProcess as SdkSpawnedProcess,
  SpawnOptions as SdkSpawnOptions,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { HeteroPermissionMode } from '@lobechat/types';
import { spawnManaged } from '@lobechat/utils/managedProcess';

import type { AskUserBridge } from '../askUser/AskUserBridge';
import {
  askThroughBridge,
  buildSetPermissionModeRequest,
  decideClaudeCodePermission,
  fromCanUseTool,
  isRunningAsRoot,
  PermissionModeReporter,
  resolveClaudeCodePermissionMode,
} from '../claudeCodePermission';
import { AgentStreamPipeline, type UploadHeterogeneousImage } from './agentStreamPipeline';
import { readClaudeCodeSessionCost } from './claudeCodeSessionCost';
import { resolveCliSpawnPlan } from './cliSpawn';
import { buildWslSpawnPlan, getSettledWslPathEnv, getWslPathEnv, parseWslCommand } from './wsl';

const CLAUDE_SDK_DISALLOWED_TOOLS = ['AskUserQuestion', 'Monitor', 'ScheduleWakeup'] as const;
const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const INPUT_CLOSE_POLL_MS = 1000;
/** How often the input stream checks for a steered message to hand over. */
const STEER_POLL_MS = 100;

const readTimeoutMs = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const resolveClaudeSdkExecutablePath = async (
  commandPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Promise<string> => {
  // A WSL command reaches the SDK verbatim (it has no `.js` extension, so the SDK
  // hands it to `spawnClaudeCodeCliProcess` as the command). Learn the distro's
  // PATH now, while still async, for that synchronous spawn hook.
  const wslCommand = parseWslCommand(commandPath);
  if (wslCommand) {
    await getWslPathEnv(wslCommand.distro);
    return commandPath;
  }
  if (platform !== 'win32' || !/\.(?:bat|cmd)$/i.test(commandPath)) return commandPath;

  // The Agent SDK spawns native paths directly and runs JavaScript paths with
  // Node. Reuse the CLI launcher's shell-free shim parser so a detected npm
  // wrapper becomes its real `cli.js`, which packaged builds can still access.
  const spawnPlan = await resolveCliSpawnPlan(commandPath, [], env);
  if (spawnPlan.command === commandPath) {
    throw new Error(`Unable to resolve the Claude Code Windows shim: ${commandPath}`);
  }

  return spawnPlan.args[0] ?? spawnPlan.command;
};

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
): Pick<ClaudeAgentSdkOptions, 'effort' | 'extraArgs' | 'model' | 'plugins'> => {
  const extraArgs: Record<string, string | null> = {};
  // `--plugin-dir` repeats, which `extraArgs` (one value per flag) cannot carry.
  const plugins: NonNullable<ClaudeAgentSdkOptions['plugins']> = [];
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

    if (key === 'plugin-dir' && hasValue) {
      plugins.push({ path: next, type: 'local' });
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
    ...(plugins.length > 0 ? { plugins } : {}),
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
  transport:
    | 'acp-stdio'
    | 'antigravity-acp'
    | 'claude-sdk'
    | 'cli-spawn'
    | 'codex-app-server'
    | 'copilot-acp'
    | 'cursor-acp'
    | 'droid-acp'
    | 'devin-acp'
    | 'pi-rpc'
    | 'trae-acp';
}

export interface ClaudeAgentSdkSessionOptions {
  args: string[];
  /** Raises the permission cards when `permissionMode` is set. */
  askUserBridge?: AskUserBridge;
  commandPath: string;
  /** Claude profile root the transcript lives under; defaults to `env.CLAUDE_CONFIG_DIR`. */
  configDir?: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  /**
   * The CLI child this session spawned. The SDK runs an actual Claude
   * executable, so a host crash can leave that process orphaned — the host
   * needs its identity to reap it on the next launch.
   */
  onProcessSpawn?: (process: { args: string[]; command: string; pid?: number }) => void;
  onRawMessage: (line: string) => Promise<void> | void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => Promise<void> | void;
  operationId: string;
  /**
   * Claude Code permission mode. With `askUserBridge`, Claude Code asks
   * through `canUseTool` and each request raises a card; absent, every action
   * is allowed.
   */
  permissionMode?: HeteroPermissionMode;
  /**
   * Have Claude Code replay every user message it reads (`--replay-user-messages`),
   * so a message `steer` delivers is known to be picked up.
   */
  replayUserMessages?: boolean;
  resumeSessionId?: string;
  sessionId: string;
  stdinPayload: string;
  /** Uploader for base64 tool_result images; see `AgentStreamPipelineOptions`. */
  uploadImage?: UploadHeterogeneousImage;
}

/**
 * Spawn the CLI the SDK would otherwise own privately.
 *
 * Two reasons to take it over: the pid has to reach the host's recovery ledger
 * (an SDK run orphaned by a main-process crash is a real Claude process, still
 * writing the transcript a replay is about to read), and the child belongs in
 * its own Unix process group like every other CLI run here, so reaping it takes
 * its tool children with it. `signal` is the SDK's forwarded one — it fires
 * only after the graceful stdin-EOF window.
 */
export const spawnClaudeCodeCliProcess = (
  options: SdkSpawnOptions,
  hooks: {
    onProcessSpawn?: (process: { args: string[]; command: string; pid?: number }) => void;
    onStderr: (data: string) => void;
  },
  platform: NodeJS.Platform = process.platform,
): SdkSpawnedProcess => {
  // The SDK types env as a plain string map; this repo augments ProcessEnv
  // with required keys, which no spawn caller carries.
  const sdkEnv = options.env as NodeJS.ProcessEnv;
  const wslCommand = parseWslCommand(options.command);
  const plan = wslCommand
    ? buildWslSpawnPlan(wslCommand, options.args, sdkEnv, getSettledWslPathEnv(wslCommand.distro))
    : { args: options.args, command: options.command, env: sdkEnv };
  const child: ChildProcess = spawnManaged(plan.command, plan.args, {
    cwd: options.cwd,
    detached: platform !== 'win32',
    env: plan.env ?? sdkEnv,
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // The SDK only wires its own `stderr` option on the spawn it owns, so this
  // pipe has nobody reading it — and a full stderr pipe blocks the CLI.
  child.stderr?.on('data', (chunk: Buffer | string) => hooks.onStderr(chunk.toString()));

  hooks.onProcessSpawn?.({
    args: [plan.command, ...plan.args],
    command: plan.command,
    pid: child.pid,
  });

  return child as unknown as SdkSpawnedProcess;
};

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
  /** Permission requests waiting for the user: no inactivity timeout meanwhile. */
  private pendingPermissions = 0;
  private readonly isRoot = isRunningAsRoot();
  private readonly modeReporter: PermissionModeReporter | undefined;
  /** Messages `steer` queued for the input stream, not yet handed to the SDK. */
  private readonly steerQueue: SDKUserMessage[] = [];
  /** Steered messages Claude Code has not replayed yet; input stays open for them. */
  private readonly unconsumed = new Set<string>();
  private taskNotificationPending = false;
  /** A turn is under way: its own `result` will decide about the input. */
  private turnOpen = true;

  constructor(private readonly options: ClaudeAgentSdkSessionOptions) {
    this.pipeline = new AgentStreamPipeline({
      agentType: 'claude-code-sdk',
      cwd: options.cwd,
      operationId: options.operationId,
      uploadImage: options.uploadImage,
    });
    this.modeReporter = this.permissionPrompts
      ? new PermissionModeReporter(
          options.operationId,
          resolveClaudeCodePermissionMode(options.permissionMode!, this.isRoot).fallback,
        )
      : undefined;
  }

  private get permissionPrompts(): boolean {
    return !!this.options.permissionMode && !!this.options.askUserBridge;
  }

  async run(): Promise<void> {
    this.emitStatus('starting');
    this.armInactivityTimer();

    try {
      if (this.options.resumeSessionId) {
        this.pipeline.configureSession({
          initialSessionCostUsd: await readClaudeCodeSessionCost({
            configDir: this.options.configDir ?? this.options.env.CLAUDE_CONFIG_DIR,
            cwd: this.options.cwd,
            home: this.options.env.HOME,
            sessionId: this.options.resumeSessionId,
          }),
        });
      }

      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const userMessage = buildClaudeSdkUserMessageFromStreamJson(this.options.stdinPayload);

      this.queryHandle = query({
        options: await this.buildQueryOptions(),
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

  /**
   * Stop one background task of the live session. CC answers with a
   * `task_notification` of status `stopped`, which is the only proof the stop
   * took: resolving here means the request was accepted, nothing more.
   *
   * @throws When no query is running any more.
   */
  async stopTask(taskId: string): Promise<void> {
    if (!this.queryHandle) throw new Error('The Claude Code session is no longer running');
    await this.queryHandle.stopTask(taskId);
  }

  /**
   * Switch the running session's permission mode (the mode chip). Claude Code
   * confirms with a `status` record, which the mode report follows.
   *
   * @returns the mode the session took (`acceptEdits` for a bypass pick as root)
   * @throws When no query is running any more.
   */
  async setPermissionMode(mode: HeteroPermissionMode): Promise<HeteroPermissionMode> {
    if (!this.queryHandle) throw new Error('The Claude Code session is no longer running');
    const taken = buildSetPermissionModeRequest(mode, this.isRoot).mode;
    // Report against the pick: as root a bypass pick runs as acceptEdits.
    this.modeReporter?.requested(mode, this.isRoot);
    await this.queryHandle.setPermissionMode(taken);
    return taken;
  }

  /**
   * Deliver a user message into the running session. Claude Code reads it at
   * its next tool boundary, so a running tool is never cut short (a message
   * sent with `priority: 'now'` would abort it). Claude Code replays it under
   * `uuid` once read (with `replayUserMessages`); until then
   * input stays open for it.
   *
   * @returns false once input has closed, so the caller runs it as a new turn
   */
  steer(message: SDKUserMessage, uuid: string): boolean {
    if (this.closeInput || this.abortController.signal.aborted) return false;

    this.unconsumed.add(uuid);
    this.steerQueue.push({ ...message, uuid: uuid as SDKUserMessage['uuid'] });
    return true;
  }

  close(): void {
    this.closedByHost = true;
    this.closeInput = true;
    this.emitStatus('closing');
    this.abortController.abort();
    this.queryHandle?.close();
  }

  private async buildQueryOptions(): Promise<ClaudeAgentSdkOptions> {
    const argOptions = parseClaudeSdkExtraArgs(this.options.args);
    const executablePath = await resolveClaudeSdkExecutablePath(
      this.options.commandPath,
      this.options.env,
    );

    return {
      ...this.buildPermissionOptions(),
      abortController: this.abortController,
      cwd: this.options.cwd,
      disallowedTools: [...CLAUDE_SDK_DISALLOWED_TOOLS],
      env: this.options.env,
      includePartialMessages: true,
      pathToClaudeCodeExecutable: executablePath,
      spawnClaudeCodeProcess: (spawnOptions) =>
        spawnClaudeCodeCliProcess(spawnOptions, {
          onProcessSpawn: this.options.onProcessSpawn,
          onStderr: (data) => void this.options.onStderr(data),
        }),
      ...(this.options.resumeSessionId ? { resume: this.options.resumeSessionId } : {}),
      ...argOptions,
      ...(this.options.replayUserMessages && {
        extraArgs: { ...argOptions.extraArgs, 'replay-user-messages': null },
      }),
      stderr: (data) => {
        void this.options.onStderr(data);
      },
    };
  }

  /**
   * Lab off: every action allowed, as before. Lab on: start in the picked mode
   * (`acceptEdits` as root, which cannot bypass) and ask through `canUseTool`.
   * Skipping permissions stays allowed off root so a later switch to
   * `bypassPermissions` takes (see `buildClaudeCodePermissionArgs`).
   */
  private buildPermissionOptions(): Pick<
    ClaudeAgentSdkOptions,
    'allowDangerouslySkipPermissions' | 'canUseTool' | 'permissionMode'
  > {
    const bridge = this.options.askUserBridge;
    if (!this.permissionPrompts || !bridge) {
      return { allowDangerouslySkipPermissions: true, permissionMode: 'bypassPermissions' };
    }

    return {
      allowDangerouslySkipPermissions: !this.isRoot,
      canUseTool: async (toolName, input, extra) => {
        const request = fromCanUseTool(extra.requestId ?? extra.toolUseID, toolName, input, {
          ...extra,
          suggestions: extra.suggestions,
          toolUseId: extra.toolUseID,
        });
        const ask = askThroughBridge(bridge);
        this.pendingPermissions += 1;
        this.clearInactivityTimer();
        try {
          return (await decideClaudeCodePermission(
            request,
            (intervention) => {
              // Claude Code withdrew the request (the turn was interrupted).
              extra.signal.addEventListener('abort', () =>
                bridge.cancel(intervention.toolCallId, 'session_ended'),
              );
              return ask(intervention);
            },
            { isRoot: this.isRoot },
          )) as PermissionResult;
        } finally {
          this.pendingPermissions -= 1;
          this.armInactivityTimer();
        }
      },
      permissionMode: resolveClaudeCodePermissionMode(this.options.permissionMode!, this.isRoot)
        .mode,
    };
  }

  private async *createInputStream(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
    yield message;

    while (!this.closeInput && !this.abortController.signal.aborted) {
      const steered = this.steerQueue.shift();
      if (steered) {
        yield steered;
        continue;
      }
      await sleep(this.unconsumed.size > 0 ? STEER_POLL_MS : INPUT_CLOSE_POLL_MS);
    }
  }

  private async consumeSdkMessage(message: SDKMessage): Promise<void> {
    this.lastEventAt = Date.now();
    this.armInactivityTimer();
    this.updateTaskState(message);
    if (message.type === 'user' && 'isReplay' in message && message.isReplay) {
      this.unconsumed.delete(message.uuid);
    }

    const line = `${JSON.stringify(message)}\n`;
    await this.options.onRawMessage(line);

    const events = await this.pipeline.push(line);
    const modeReport = this.modeReporter?.observe(message);
    if (modeReport) events.unshift(modeReport);
    this.sawErrorEvent ||= events.some((event) => event.type === 'error');
    await this.options.onEvents(events);

    if (this.pipeline.sessionId) this.options.onSessionId(this.pipeline.sessionId);
    this.trackTurn(message);
    this.maybeCloseInputAfterResult(message);
    this.maybeCloseInputAfterStop(message);
    this.emitStatus(this.resolveRuntimeState());
  }

  private trackTurn(message: SDKMessage): void {
    if (message.type === 'result') this.turnOpen = false;
    else if (
      message.type === 'assistant' ||
      (message.type === 'system' && message.subtype === 'init')
    ) {
      this.turnOpen = true;
    }
  }

  /**
   * Claude Code wakes the model for a task that ended on its own, not for one
   * that was stopped: no `result` follows a `stopped` notification. Between
   * turns, the last task being stopped is therefore what ends the session.
   */
  private maybeCloseInputAfterStop(message: SDKMessage): void {
    if (message.type !== 'system' || message.subtype !== 'task_notification') return;
    if (message.status !== 'stopped' || this.turnOpen) return;
    // A steered message still waiting to be read starts the next turn.
    if (this.unconsumed.size > 0 || this.steerQueue.length > 0) return;
    if (this.activeTasks.size === 0 && !this.taskNotificationPending) this.closeInput = true;
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
      // A stopped task wakes no follow-up turn (see `maybeCloseInputAfterStop`).
      if (message.status !== 'stopped') this.taskNotificationPending = true;
      this.activeTasks.delete(message.task_id);
    }
  }

  /**
   * Close the input once nothing can still need it. It stays open while a task
   * lives: stopping one is a control request written to it, and with the input
   * closed Claude Code never reads the request.
   */
  private maybeCloseInputAfterResult(message: SDKMessage): void {
    if (message.type !== 'result') return;
    const notificationTurn = message.origin?.kind === 'task-notification';
    // The notification's turn is over, whether or not input closes now.
    if (notificationTurn) this.taskNotificationPending = false;
    // A message written as a cycle ends is read after that cycle's result;
    // it still has to be read and answered.
    if (this.unconsumed.size > 0 || this.steerQueue.length > 0) return;

    // A resumed session first reports the previous run's leftover tasks and
    // ends that pass with an empty result, before this run's own turn.
    if (notificationTurn && message.num_turns === 0) return;

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
    // A permission request waits for the user, however long that takes.
    if (this.pendingPermissions > 0) return;
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
