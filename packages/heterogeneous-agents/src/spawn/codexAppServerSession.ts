import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import path from 'node:path';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { UsageData } from '../types';
import { AgentStreamPipeline } from './agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from './claudeAgentSdkSession';
import { resolveCliSpawnPlan } from './cliSpawn';
import type { AgentInputPlan } from './input';

const APP_SERVER_RPC_TIMEOUT_MS = 30_000;
const CODEX_APP_SERVER_TRANSPORT = 'codex-app-server' as const;
const CODEX_DANGEROUS_BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';
const CODEX_FULL_AUTO_FLAG = '--full-auto';
const CODEX_APPROVAL_FLAGS = ['-a', '--ask-for-approval'] as const;
const CODEX_CONFIG_FLAGS = ['-c', '--config'] as const;
const CODEX_CWD_FLAGS = ['-C', '--cd'] as const;
const CODEX_MODEL_FLAGS = ['-m', '--model'] as const;
const CODEX_PROFILE_FLAGS = ['-p', '--profile'] as const;
const CODEX_SANDBOX_FLAGS = ['-s', '--sandbox'] as const;
const CODEX_EPHEMERAL_FLAG = '--ephemeral';
const CODEX_IGNORE_USER_CONFIG_FLAG = '--ignore-user-config';

interface CodexAppServerTextInput {
  text: string;
  text_elements: [];
  type: 'text';
}

interface CodexAppServerLocalImageInput {
  path: string;
  type: 'localImage';
}

export type CodexAppServerUserInput = CodexAppServerLocalImageInput | CodexAppServerTextInput;

interface RpcError {
  code?: number;
  data?: unknown;
  message?: string;
}

interface RpcMessage {
  error?: RpcError;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

interface PendingRpcRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface CodexThreadResponse {
  model?: string;
  thread?: { id?: string };
}

interface CodexTurnResponse {
  turn?: { id?: string };
}

interface CodexTokenUsageBreakdown {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

interface CodexThreadTokenUsage {
  total?: CodexTokenUsageBreakdown;
}

interface CodexTurnPlanStep {
  status?: string;
  step?: string;
}

interface CodexAppServerItem {
  [key: string]: unknown;
  id?: string;
  type?: string;
}

type CodexAppServerApprovalPolicy = 'never' | 'on-request' | 'untrusted';
type CodexAppServerSandboxMode = 'danger-full-access' | 'read-only' | 'workspace-write';

export interface CodexAppServerThreadParams {
  approvalPolicy: CodexAppServerApprovalPolicy;
  cwd: string;
  ephemeral?: boolean;
  model?: string;
  modelProvider?: string;
  sandbox: CodexAppServerSandboxMode;
  serviceTier?: string;
}

export interface CodexAppServerSessionOptions {
  args: string[];
  clientVersion: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  initialCumulativeUsage?: UsageData | undefined;
  initialModel?: string | undefined;
  input: CodexAppServerUserInput[];
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  onModel?: (model: string) => void;
  onRawMessage: (line: string) => Promise<void> | void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => Promise<void> | void;
  operationId: string;
  resumeSessionId?: string;
  sessionId: string;
}

const getFlagValue = (arg: string, flags: readonly string[]) => {
  const flag = flags.find((candidate) => arg.startsWith(`${candidate}=`));
  return flag ? arg.slice(flag.length + 1) : undefined;
};

const parseConfigValue = (raw: string): unknown => {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  const number = Number(value);
  if (value && Number.isFinite(number)) return number;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('[') && value.endsWith(']')) ||
    (value.startsWith('{') && value.endsWith('}'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      // Keep non-JSON TOML values as strings; app-server validates the config.
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
};

const parseConfigOverride = (raw: string) => {
  const separator = raw.indexOf('=');
  if (separator <= 0) return;
  const key = raw.slice(0, separator).trim();
  if (!key) return;
  return { key, value: parseConfigValue(raw.slice(separator + 1)) };
};

const isSandboxMode = (value: string): value is CodexAppServerSandboxMode =>
  value === 'danger-full-access' || value === 'read-only' || value === 'workspace-write';

/** App-server consumes global config overrides itself; preserve their raw TOML values. */
export const buildCodexAppServerArgs = (args: string[] = []): string[] => {
  const configArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (getFlagValue(arg, CODEX_CONFIG_FLAGS) !== undefined) {
      configArgs.push(arg);
      continue;
    }
    if (!CODEX_CONFIG_FLAGS.includes(arg as (typeof CODEX_CONFIG_FLAGS)[number])) continue;

    const value = args[index + 1];
    if (value) {
      configArgs.push(arg, value);
      index += 1;
    }
  }

  return [...configArgs, 'app-server'];
};

/**
 * Unknown or loader-only CLI arguments must use the existing `codex exec` path instead of being
 * silently discarded. Interactive approval modes also stay on that path until app-server has UI.
 */
export const getCodexAppServerUnsupportedArgs = (
  args: string[],
  options: { resume?: boolean } = {},
): string[] => {
  const unsupported: string[] = [];
  const hasSandboxFlag = args.some(
    (arg) =>
      CODEX_SANDBOX_FLAGS.includes(arg as (typeof CODEX_SANDBOX_FLAGS)[number]) ||
      getFlagValue(arg, CODEX_SANDBOX_FLAGS) !== undefined,
  );

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      if (hasSandboxFlag) unsupported.push(arg);
      continue;
    }
    if (arg === CODEX_EPHEMERAL_FLAG) {
      if (options.resume) unsupported.push(arg);
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG || arg === CODEX_IGNORE_USER_CONFIG_FLAG) {
      unsupported.push(arg);
      continue;
    }

    const valueFlags = [
      ...CODEX_MODEL_FLAGS,
      ...CODEX_CONFIG_FLAGS,
      ...CODEX_CWD_FLAGS,
      ...CODEX_APPROVAL_FLAGS,
      ...CODEX_SANDBOX_FLAGS,
    ];
    const exactFlag = valueFlags.find((flag) => arg === flag);
    const inlineFlag = valueFlags.find((flag) => arg.startsWith(`${flag}=`));
    if (exactFlag || inlineFlag) {
      const value = inlineFlag ? arg.slice(inlineFlag.length + 1) : args[index + 1];
      if (!value || (!inlineFlag && value.startsWith('-'))) {
        unsupported.push(arg);
        continue;
      }
      if (!inlineFlag) index += 1;

      if (
        CODEX_APPROVAL_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_APPROVAL_FLAGS)[number],
        ) &&
        value !== 'never'
      ) {
        unsupported.push(arg);
      }
      if (
        CODEX_SANDBOX_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_SANDBOX_FLAGS)[number],
        ) &&
        !isSandboxMode(value)
      ) {
        unsupported.push(arg);
      }
      if (
        CODEX_CONFIG_FLAGS.includes(
          (exactFlag ?? inlineFlag) as (typeof CODEX_CONFIG_FLAGS)[number],
        )
      ) {
        const override = parseConfigOverride(value);
        if (override?.key === 'approval_policy' && override.value !== 'never') {
          unsupported.push(arg);
        }
      }
      continue;
    }

    if (
      CODEX_PROFILE_FLAGS.includes(arg as (typeof CODEX_PROFILE_FLAGS)[number]) ||
      getFlagValue(arg, CODEX_PROFILE_FLAGS) !== undefined
    ) {
      unsupported.push(arg);
      if (CODEX_PROFILE_FLAGS.includes(arg as (typeof CODEX_PROFILE_FLAGS)[number])) index += 1;
      continue;
    }

    unsupported.push(arg);
  }

  return unsupported;
};

export const buildCodexAppServerThreadParams = (
  args: string[],
  cwd: string,
  initialModel?: string,
): CodexAppServerThreadParams => {
  const approvalPolicy: CodexAppServerApprovalPolicy = 'never';
  let effectiveCwd = cwd;
  let ephemeral = false;
  let model = initialModel;
  let modelProvider: string | undefined;
  let sandbox: CodexAppServerSandboxMode = 'danger-full-access';
  let serviceTier: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === CODEX_DANGEROUS_BYPASS_FLAG) {
      sandbox = 'danger-full-access';
      continue;
    }
    if (arg === CODEX_FULL_AUTO_FLAG) {
      sandbox = 'workspace-write';
      continue;
    }
    if (arg === CODEX_EPHEMERAL_FLAG) {
      ephemeral = true;
      continue;
    }

    const next = args[index + 1];
    const modelValue = getFlagValue(arg, CODEX_MODEL_FLAGS);
    if (modelValue !== undefined) {
      if (modelValue) model = modelValue;
      continue;
    }
    if (CODEX_MODEL_FLAGS.includes(arg as (typeof CODEX_MODEL_FLAGS)[number]) && next) {
      model = next;
      index += 1;
      continue;
    }

    const approvalValue = getFlagValue(arg, CODEX_APPROVAL_FLAGS);
    if (approvalValue !== undefined) {
      continue;
    }
    if (CODEX_APPROVAL_FLAGS.includes(arg as (typeof CODEX_APPROVAL_FLAGS)[number]) && next) {
      index += 1;
      continue;
    }

    const sandboxValue = getFlagValue(arg, CODEX_SANDBOX_FLAGS);
    if (sandboxValue !== undefined) {
      if (isSandboxMode(sandboxValue)) sandbox = sandboxValue;
      continue;
    }
    if (CODEX_SANDBOX_FLAGS.includes(arg as (typeof CODEX_SANDBOX_FLAGS)[number]) && next) {
      if (isSandboxMode(next)) sandbox = next;
      index += 1;
      continue;
    }

    const cwdValue = getFlagValue(arg, CODEX_CWD_FLAGS);
    if (cwdValue !== undefined) {
      if (cwdValue) effectiveCwd = path.resolve(cwd, cwdValue);
      continue;
    }
    if (CODEX_CWD_FLAGS.includes(arg as (typeof CODEX_CWD_FLAGS)[number]) && next) {
      effectiveCwd = path.resolve(cwd, next);
      index += 1;
      continue;
    }

    const configValue = getFlagValue(arg, CODEX_CONFIG_FLAGS);
    const isConfigFlag = CODEX_CONFIG_FLAGS.includes(arg as (typeof CODEX_CONFIG_FLAGS)[number]);
    if (configValue === undefined && !isConfigFlag) continue;
    if (configValue === undefined && next) index += 1;
    const configOverride = parseConfigOverride(configValue ?? next ?? '');
    if (!configOverride) continue;
    if (configOverride.key === 'model' && typeof configOverride.value === 'string') {
      model = configOverride.value;
    }
    if (configOverride.key === 'model_provider' && typeof configOverride.value === 'string') {
      modelProvider = configOverride.value;
    }
    if (
      configOverride.key === 'sandbox_mode' &&
      typeof configOverride.value === 'string' &&
      isSandboxMode(configOverride.value)
    )
      sandbox = configOverride.value;
    if (configOverride.key === 'service_tier' && typeof configOverride.value === 'string') {
      serviceTier = configOverride.value;
    }
  }

  return {
    approvalPolicy,
    cwd: effectiveCwd,
    ...(ephemeral ? { ephemeral } : {}),
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
    sandbox,
    ...(serviceTier ? { serviceTier } : {}),
  };
};

export const buildCodexAppServerInput = (plan: AgentInputPlan): CodexAppServerUserInput[] => {
  const input: CodexAppServerUserInput[] = [];
  if (plan.stdin) input.push({ text: plan.stdin, text_elements: [], type: 'text' });

  for (let index = 0; index < plan.args.length; index += 1) {
    if (plan.args[index] !== '--image') continue;
    const imagePath = plan.args[index + 1];
    if (imagePath) input.push({ path: imagePath, type: 'localImage' });
    index += 1;
  }

  return input;
};

const normalizeStatus = (status: unknown): unknown => {
  if (status === 'inProgress') return 'in_progress';
  if (status === 'declined') return 'failed';
  return status;
};

/** Convert stable v2 app-server items into the existing `codex exec --json` item shape. */
const normalizeAppServerItem = (item: CodexAppServerItem): CodexAppServerItem | undefined => {
  switch (item.type) {
    case 'agentMessage': {
      return { ...item, type: 'agent_message' };
    }
    case 'commandExecution': {
      return {
        ...item,
        aggregated_output: item.aggregatedOutput,
        exit_code: item.exitCode,
        status: normalizeStatus(item.status),
        type: 'command_execution',
      };
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes)
        ? item.changes.map((change) => {
            const value = change as Record<string, unknown>;
            const kind = value.kind;
            const kindValue =
              typeof kind === 'object' && kind !== null
                ? (kind as Record<string, unknown>)
                : undefined;
            return {
              ...value,
              diffText: value.diff,
              kind: kindValue?.movePath ? 'rename' : (kindValue?.type ?? kind),
            };
          })
        : [];
      return {
        ...item,
        changes,
        status: normalizeStatus(item.status),
        type: 'file_change',
      };
    }
    case 'mcpToolCall': {
      return {
        ...item,
        status: normalizeStatus(item.status),
        type: 'mcp_tool_call',
      };
    }
    case 'collabAgentToolCall': {
      return {
        ...item,
        agents_states: item.agentsStates,
        receiver_thread_ids: item.receiverThreadIds,
        sender_thread_id: item.senderThreadId,
        status: normalizeStatus(item.status),
        type: 'collab_tool_call',
      };
    }
    case 'dynamicToolCall': {
      return {
        ...item,
        status: normalizeStatus(item.status),
        type: 'dynamic_tool_call',
      };
    }
    case 'webSearch': {
      return { ...item, status: normalizeStatus(item.status), type: 'web_search' };
    }
    default: {
      return;
    }
  }
};

const toExecUsage = (usage: CodexTokenUsageBreakdown | undefined) =>
  usage
    ? {
        cached_input_tokens: usage.cachedInputTokens,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        reasoning_output_tokens: usage.reasoningOutputTokens,
      }
    : undefined;

export class CodexAppServerSession {
  private readonly pipeline: AgentStreamPipeline;
  private readonly pendingRequests = new Map<string, PendingRpcRequest>();
  private readonly threadParams: CodexAppServerThreadParams;
  private activeFileChangeItemId?: string;
  private child?: ChildProcess;
  private closedByHost = false;
  private fatalError?: Error;
  private latestTokenUsage?: CodexThreadTokenUsage;
  private latestPlanItem?: CodexAppServerItem;
  private notificationQueue = Promise.resolve();
  private nextRequestId = 0;
  private stdoutBuffer = '';
  private threadId?: string;
  private turnId?: string;
  private turnCompletion?: Promise<void>;
  private rejectTurn?: (error: Error) => void;
  private resolveTurn?: () => void;

  constructor(private readonly options: CodexAppServerSessionOptions) {
    this.threadParams = buildCodexAppServerThreadParams(
      options.args,
      options.cwd,
      options.initialModel,
    );
    this.pipeline = new AgentStreamPipeline({
      agentType: 'codex',
      cwd: this.threadParams.cwd,
      initialCumulativeUsage: options.initialCumulativeUsage,
      initialModel: options.initialModel,
      operationId: options.operationId,
    });
  }

  async run(): Promise<void> {
    this.emitStatus('starting');

    try {
      await this.startProcess();
      await this.request('initialize', {
        capabilities: { experimentalApi: false },
        clientInfo: {
          name: 'lobehub-desktop',
          title: 'LobeHub Desktop',
          version: this.options.clientVersion,
        },
      });
      this.sendNotification('initialized', {});

      const resumeThreadParams = { ...this.threadParams };
      delete resumeThreadParams.ephemeral;
      const thread = this.options.resumeSessionId
        ? await this.request<CodexThreadResponse>('thread/resume', {
            ...resumeThreadParams,
            threadId: this.options.resumeSessionId,
          })
        : await this.request<CodexThreadResponse>('thread/start', this.threadParams);
      const threadId = thread.thread?.id;
      if (!threadId) throw new Error('Codex app-server returned no thread id');

      this.threadId = threadId;
      if (!this.threadParams.ephemeral) this.options.onSessionId(threadId);
      await this.emitSynthetic({ thread_id: threadId, type: 'thread.started' });
      if (thread.model) {
        this.options.onModel?.(thread.model);
        await this.emitEvents(this.pipeline.configureSession({ model: thread.model }));
      }

      this.turnCompletion = new Promise<void>((resolve, reject) => {
        this.resolveTurn = resolve;
        this.rejectTurn = reject;
      });
      void this.turnCompletion.catch(() => {});
      const turn = await this.request<CodexTurnResponse>('turn/start', {
        input: this.options.input,
        threadId,
      });
      this.turnId = turn.turn?.id;
      this.emitStatus('running');

      await this.turnCompletion;
      await this.notificationQueue;
      await this.emitEvents(await this.pipeline.flush());
      this.emitStatus('idle');
    } catch (error) {
      if (this.closedByHost) {
        this.emitStatus('closed');
        return;
      }

      this.emitStatus('error');
      throw error;
    } finally {
      this.shutdownProcess('SIGTERM');
      if (!this.closedByHost) this.emitStatus('closed');
    }
  }

  async interrupt(): Promise<void> {
    if (!this.threadId || !this.turnId) {
      this.close();
      return;
    }

    await this.request('turn/interrupt', {
      threadId: this.threadId,
      turnId: this.turnId,
    });
  }

  close(): void {
    this.closedByHost = true;
    this.rejectTurn?.(new Error('Codex app-server session closed by host'));
    this.rejectPendingRequests(new Error('Codex app-server session closed by host'));
    this.shutdownProcess('SIGTERM');
    this.emitStatus('closed');
  }

  private async startProcess(): Promise<void> {
    const spawnPlan = await resolveCliSpawnPlan(
      this.options.commandPath,
      buildCodexAppServerArgs(this.options.args),
    );
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32',
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdin?.on('error', () => {
      // The process error/exit listener reports the actionable failure. Swallow
      // a racing EPIPE from an RPC write so it cannot crash Electron main.
    });
    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      void this.options.onStderr(chunk.toString('utf8'));
    });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      if (this.closedByHost) return;
      this.fail(
        new Error(
          `Codex app-server exited before the turn completed (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
        ),
      );
    });
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');

    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;

      void this.options.onRawMessage(`${line}\n`);
      try {
        this.handleRpcMessage(JSON.parse(line) as RpcMessage);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private handleRpcMessage(message: RpcMessage): void {
    if (message.method) {
      if (message.id !== undefined) {
        this.handleServerRequest(message);
        return;
      }

      this.notificationQueue = this.notificationQueue
        .then(() => this.handleNotification(message.method!, message.params ?? {}))
        .catch((error) => {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        });
      return;
    }

    if (message.id === undefined) return;
    const pending = this.pendingRequests.get(String(message.id));
    if (!pending) return;

    this.pendingRequests.delete(String(message.id));
    clearTimeout(pending.timeout);
    if (message.error) {
      pending.reject(new Error(message.error.message ?? 'Codex app-server request failed'));
    } else {
      pending.resolve(message.result);
    }
  }

  private async handleNotification(method: string, params: Record<string, unknown>): Promise<void> {
    if (this.threadId && typeof params.threadId === 'string' && params.threadId !== this.threadId) {
      return;
    }

    switch (method) {
      case 'turn/started': {
        const turn = params.turn as { id?: string } | undefined;
        this.turnId = turn?.id ?? this.turnId;
        await this.emitSynthetic({ turn, type: 'turn.started' });
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const item = normalizeAppServerItem((params.item ?? {}) as CodexAppServerItem);
        if (!item) return;
        if (method === 'item/started' && item.type === 'file_change' && item.id) {
          this.activeFileChangeItemId = item.id;
        }
        await this.emitSynthetic({
          item,
          type: method === 'item/started' ? 'item.started' : 'item.completed',
        });
        if (method === 'item/completed' && item.id === this.activeFileChangeItemId) {
          this.activeFileChangeItemId = undefined;
        }
        return;
      }
      case 'item/agentMessage/delta': {
        await this.emitSynthetic({
          delta: params.delta,
          item_id: params.itemId,
          type: 'item.agent_message.delta',
        });
        return;
      }
      case 'item/commandExecution/outputDelta': {
        await this.emitSynthetic({
          delta: params.delta,
          item_id: params.itemId,
          type: 'item.command_execution.output_delta',
        });
        return;
      }
      case 'turn/diff/updated': {
        if (!this.activeFileChangeItemId || typeof params.diff !== 'string') return;
        await this.emitSynthetic({
          item: {
            changes: [{ diffText: params.diff }],
            id: this.activeFileChangeItemId,
            status: 'in_progress',
            type: 'file_change',
          },
          type: 'item.updated',
        });
        return;
      }
      case 'turn/plan/updated': {
        const plan = Array.isArray(params.plan) ? (params.plan as CodexTurnPlanStep[]) : [];
        const planItemId = `turn-plan-${String(params.turnId ?? this.turnId ?? 'current')}`;
        const item: CodexAppServerItem = {
          id: planItemId,
          items: plan
            .filter((step) => typeof step.step === 'string' && step.step.trim())
            .map((step) => ({ completed: step.status === 'completed', text: step.step })),
          status: 'in_progress',
          type: 'todo_list',
        };
        const type = this.latestPlanItem?.id === planItemId ? 'item.updated' : 'item.started';
        this.latestPlanItem = item;
        await this.emitSynthetic({ item, type });
        return;
      }
      case 'thread/tokenUsage/updated': {
        this.latestTokenUsage = params.tokenUsage as CodexThreadTokenUsage;
        return;
      }
      case 'error': {
        if (params.willRetry === true) return;
        const error = params.error as { message?: string } | undefined;
        await this.emitSynthetic({
          message: error?.message ?? 'Codex execution failed',
          type: 'error',
        });
        return;
      }
      case 'turn/completed': {
        const turn = params.turn as { error?: { message?: string }; id?: string; status?: string };
        this.turnId = turn.id ?? this.turnId;
        if (turn.status === 'completed') {
          if (this.latestPlanItem) {
            await this.emitSynthetic({
              item: { ...this.latestPlanItem, status: 'completed' },
              type: 'item.completed',
            });
          }
          await this.emitSynthetic({
            type: 'turn.completed',
            usage: toExecUsage(this.latestTokenUsage?.total),
          });
        } else if (turn.status === 'interrupted') {
          await this.emitSynthetic({
            reason: 'interrupted',
            type: 'turn.completed',
            usage: toExecUsage(this.latestTokenUsage?.total),
          });
        } else {
          await this.emitSynthetic({
            message:
              turn.error?.message ??
              (turn.status === 'failed'
                ? 'Codex execution failed'
                : `Codex app-server returned unexpected turn status: ${turn.status ?? 'unknown'}`),
            type: 'turn.failed',
          });
        }
        this.latestPlanItem = undefined;
        this.resolveTurn?.();
        return;
      }
    }
  }

  private handleServerRequest(message: RpcMessage): void {
    if (!this.child?.stdin || message.id === undefined) return;

    if (
      message.method === 'item/commandExecution/requestApproval' ||
      message.method === 'item/fileChange/requestApproval'
    ) {
      // This transport only starts non-interactive (`never`) threads. A request is therefore an
      // unexpected escalation; cancel it rather than silently bypassing the configured boundary.
      this.writeRpc({ id: message.id, result: { decision: 'cancel' } });
      return;
    }

    this.writeRpc({
      error: { code: -32_601, message: `Unsupported Codex app-server request: ${message.method}` },
      id: message.id,
    });
  }

  private request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (!this.child?.stdin)
      return Promise.reject(new Error('Codex app-server stdin is unavailable'));

    const id = ++this.nextRequestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, APP_SERVER_RPC_TIMEOUT_MS);
      timeout.unref?.();
      this.pendingRequests.set(String(id), {
        reject,
        resolve: (result) => resolve(result as T),
        timeout,
      });
      this.writeRpc({ id, method, params });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    this.writeRpc({ method, params });
  }

  private writeRpc(message: Record<string, unknown>): void {
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  private async emitSynthetic(payload: Record<string, unknown>): Promise<void> {
    await this.emitEvents(await this.pipeline.push(`${JSON.stringify(payload)}\n`));
  }

  private async emitEvents(events: AgentStreamEvent[]): Promise<void> {
    if (events.length > 0) await this.options.onEvents(events);
  }

  private emitStatus(state: HeterogeneousAgentRuntimeStatus['state']): void {
    this.options.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: Date.now(),
      operationId: this.options.operationId,
      sessionId: this.options.sessionId,
      state,
      transport: CODEX_APP_SERVER_TRANSPORT,
    });
  }

  private fail(error: Error): void {
    this.fatalError ??= error;
    this.rejectTurn?.(error);
    this.rejectPendingRequests(error);
  }

  private rejectPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private shutdownProcess(signal: NodeJS.Signals): void {
    const child = this.child;
    this.child = undefined;
    if (!child?.pid || child.killed) return;

    if (process.platform === 'win32') {
      child.kill(signal);
      return;
    }

    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
}
