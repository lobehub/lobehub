import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import { AgentStreamPipeline } from './agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from './claudeAgentSdkSession';
import { resolveCliSpawnPlan } from './cliSpawn';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { normalizeImage } from './input';

const RPC_TIMEOUT_MS = 30_000;
const NOTIFICATION_DRAIN_QUIET_MS = 250;
const NOTIFICATION_DRAIN_TIMEOUT_MS = 2000;
const TRANSPORT = 'trae-acp' as const;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface TraeAcpTextPromptBlock {
  text: string;
  type: 'text';
}

export interface TraeAcpImagePromptBlock {
  data: string;
  mimeType: string;
  type: 'image';
}

export type TraeAcpPromptBlock = TraeAcpImagePromptBlock | TraeAcpTextPromptBlock;

export const buildTraeAcpArgs = (extraArgs: string[] = []): string[] => [
  'acp',
  'serve',
  '--yolo',
  ...extraArgs,
];

export const buildTraeAcpPrompt = async (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<TraeAcpPromptBlock[]> => {
  const blocks = typeof prompt === 'string' ? [{ text: prompt, type: 'text' as const }] : prompt;
  const result: TraeAcpPromptBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'text') {
      result.push({ text: block.text, type: 'text' });
    } else {
      const image = await normalizeImage(block.source, options);
      result.push({
        data: image.buffer.toString('base64'),
        mimeType: image.mediaType,
        type: 'image',
      });
    }
  }
  return result;
};

interface RpcMessage {
  error?: { code?: number; data?: unknown; message?: string };
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

interface TraeAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
  };
  protocolVersion?: number;
}

interface TraeAcpSessionResult {
  models?: {
    availableModels?: unknown;
    currentModelId?: unknown;
  };
  sessionId?: string;
}

interface TraeAcpPromptResult {
  stopReason?: string;
}

interface TraeAcpModelOption {
  modelId?: unknown;
  name?: unknown;
}

interface TraeAcpPermissionOption {
  kind?: unknown;
  optionId?: unknown;
}

export interface TraeAcpSessionOptions {
  args: string[];
  clientVersion: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  initialModel?: string;
  inputOptions?: BuildAgentInputOptions;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  onModel?: (model: string) => void;
  onRawMessage: (line: string) => Promise<void> | void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => Promise<void> | void;
  operationId: string;
  prompt: AgentPromptInput | TraeAcpPromptBlock[];
  resumeSessionId?: string;
  sessionId: string;
}

export class TraeAcpSession {
  private child?: ChildProcess;
  private acceptUpdates = false;
  private closedByHost = false;
  private completed = false;
  private fatalError?: Error;
  private interruptTimer?: ReturnType<typeof setTimeout>;
  private lastSessionUpdateAt = 0;
  private notificationQueue = Promise.resolve();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pipeline: AgentStreamPipeline;
  private requestId = 0;
  private session?: string;
  private stdoutBuffer = '';

  constructor(private readonly options: TraeAcpSessionOptions) {
    this.pipeline = new AgentStreamPipeline({
      agentType: 'trae',
      operationId: options.operationId,
    });
  }

  get nativeSessionId(): string | undefined {
    return this.session;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  async run(): Promise<void> {
    this.status('starting');
    try {
      const prompt = await this.resolvePrompt();
      await this.startProcess();
      const initialized = await this.request<TraeAcpInitializeResult>('initialize', {
        clientCapabilities: {},
        clientInfo: {
          name: 'lobehub',
          title: 'LobeHub',
          version: this.options.clientVersion,
        },
        protocolVersion: 1,
      });
      if (typeof initialized?.protocolVersion === 'number' && initialized.protocolVersion !== 1) {
        throw new Error(
          `TRAE ACP returned unsupported protocol version: ${initialized.protocolVersion}`,
        );
      }
      if (
        prompt.some((block) => block.type === 'image') &&
        initialized?.agentCapabilities?.promptCapabilities?.image !== true
      ) {
        throw new Error('TRAE ACP agent does not support image prompt blocks');
      }
      if (this.options.resumeSessionId && initialized?.agentCapabilities?.loadSession !== true) {
        throw new Error('TRAE ACP agent does not support loading sessions');
      }

      const sessionResult = await this.request<TraeAcpSessionResult>(
        this.options.resumeSessionId ? 'session/load' : 'session/new',
        {
          cwd: this.options.cwd,
          mcpServers: [],
          ...(this.options.resumeSessionId ? { sessionId: this.options.resumeSessionId } : {}),
        },
      );
      const sessionId = sessionResult?.sessionId ?? this.options.resumeSessionId;
      if (!sessionId) throw new Error('TRAE ACP returned no session id');
      this.session = sessionId;
      this.options.onSessionId(sessionId);

      const model = this.resolveModel(sessionResult?.models);
      if (this.options.initialModel) {
        await this.request('session/set_model', {
          modelId: model,
          sessionId,
        });
      }
      if (model) {
        this.pipeline.configureSession({ model });
        this.options.onModel?.(model);
      }
      await this.emit({
        model,
        sessionId,
        type: 'trae_session',
      });
      this.status('running');
      // session/load may replay historical updates before returning. Keep setup
      // notifications gated until the new prompt is about to start.
      this.acceptUpdates = true;
      const response = await this.request<TraeAcpPromptResult>(
        'session/prompt',
        { prompt, sessionId },
        false,
      );
      await this.drainNotifications();
      if (this.fatalError) throw this.fatalError;
      await this.emit({ stopReason: response?.stopReason, type: 'trae_prompt_completed' });
      await this.emitEvents(await this.pipeline.flush());
      this.completed = true;
      this.status('idle');
    } catch (cause) {
      if (this.closedByHost) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.emit({ message: error.message, type: 'trae_error' });
      await this.emitEvents(await this.pipeline.flush());
      throw error;
    } finally {
      this.shutdown('SIGTERM');
      this.status('closed');
    }
  }

  async interrupt(): Promise<void> {
    if (!this.session) {
      this.close();
      return;
    }
    this.notify('session/cancel', { sessionId: this.session });
    this.interruptTimer = setTimeout(() => this.close(), 2000);
    this.interruptTimer.unref?.();
  }

  close(): void {
    this.closedByHost = true;
    this.rejectPending(new Error('TRAE ACP session closed by host'));
    this.shutdown('SIGTERM');
  }

  private async resolvePrompt(): Promise<TraeAcpPromptBlock[]> {
    const prompt = this.options.prompt;
    if (
      Array.isArray(prompt) &&
      prompt.every(
        (block) =>
          'type' in block && (block.type === 'text' || ('data' in block && block.type === 'image')),
      )
    ) {
      return prompt as TraeAcpPromptBlock[];
    }
    return buildTraeAcpPrompt(prompt as AgentPromptInput, this.options.inputOptions);
  }

  private async startProcess(): Promise<void> {
    const plan = await resolveCliSpawnPlan(
      this.options.commandPath,
      buildTraeAcpArgs(this.options.args),
    );
    const child = spawn(plan.command, plan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32',
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdin?.on('error', () => {});
    child.stdout?.on('data', (chunk: Buffer) => this.consume(chunk));
    child.stderr?.on('data', (chunk: Buffer) => void this.options.onStderr(chunk.toString()));
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      if (!this.closedByHost && !this.completed) {
        this.fail(
          new Error(
            `TRAE ACP exited prematurely (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
          ),
        );
      }
    });
  }

  private consume(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');
    let index: number;
    while ((index = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (!line) continue;
      void this.options.onRawMessage(`${line}\n`);
      try {
        const message: unknown = JSON.parse(line);
        if (!message || typeof message !== 'object') {
          throw new Error('TRAE ACP returned a non-object JSON-RPC message');
        }
        this.handle(message as RpcMessage);
      } catch (cause) {
        this.fail(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
  }

  private handle(message: RpcMessage): void {
    if (message.method) {
      if (message.id !== undefined) return this.serverRequest(message);
      const suppress = !this.acceptUpdates && message.method === 'session/update';
      if (!suppress && message.method === 'session/update') {
        this.lastSessionUpdateAt = Date.now();
      }
      this.notificationQueue = this.notificationQueue.then(async () => {
        const update = message.params?.update;
        if (
          !suppress &&
          message.method === 'session/update' &&
          update &&
          typeof update === 'object'
        ) {
          await this.emit(update as Record<string, unknown>);
        }
      });
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    if (pending.timeout) clearTimeout(pending.timeout);
    message.error
      ? pending.reject(new Error(message.error.message ?? 'TRAE ACP request failed'))
      : pending.resolve(message.result);
  }

  private serverRequest(message: RpcMessage): void {
    if (message.method === 'session/request_permission') {
      const options = Array.isArray(message.params?.options)
        ? message.params.options.map((value) => value as TraeAcpPermissionOption | null)
        : [];
      const selected =
        options.find(
          (option) =>
            option?.optionId === 'allow_session' || option?.optionId === 'approve_for_session',
        ) ??
        options.find((option) => option?.kind === 'allow_once') ??
        options.find((option) => option?.kind === 'reject_once');
      if (typeof selected?.optionId === 'string') {
        this.write({
          id: message.id,
          result: { outcome: { optionId: selected.optionId, outcome: 'selected' } },
        });
      } else {
        this.write({
          error: { code: -32603, message: 'No safe permission option was offered' },
          id: message.id,
        });
      }
      return;
    }
    this.write({ error: { code: -32601, message: 'Method not found' }, id: message.id });
  }

  private request<TResult = unknown>(
    method: string,
    params: unknown,
    timed = true,
  ): Promise<TResult> {
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (!this.child?.stdin) return Promise.reject(new Error('TRAE ACP stdin is unavailable'));

    const id = ++this.requestId;
    return new Promise<TResult>((resolve, reject) => {
      const timeout = timed
        ? setTimeout(() => {
            this.pending.delete(String(id));
            reject(new Error(`TRAE ACP request timed out: ${method}`));
          }, RPC_TIMEOUT_MS)
        : undefined;
      timeout?.unref?.();
      this.pending.set(String(id), {
        reject,
        resolve: (result) => resolve(result as TResult),
        timeout,
      });
      this.write({ id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  private write(message: Record<string, unknown>): void {
    this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private async emit(payload: Record<string, unknown>): Promise<void> {
    await this.emitEvents(await this.pipeline.push(`${JSON.stringify(payload)}\n`));
  }

  private async emitEvents(events: AgentStreamEvent[]): Promise<void> {
    if (events.length) await this.options.onEvents(events);
  }

  private resolveModel(models: TraeAcpSessionResult['models']): string | undefined {
    if (!this.options.initialModel) {
      return typeof models?.currentModelId === 'string' ? models.currentModelId : undefined;
    }
    if (!Array.isArray(models?.availableModels)) return this.options.initialModel;

    const selected = models.availableModels
      .map((value) => value as TraeAcpModelOption | null)
      .find(
        (value) =>
          value?.modelId === this.options.initialModel || value?.name === this.options.initialModel,
      );
    return typeof selected?.modelId === 'string' ? selected.modelId : this.options.initialModel;
  }

  private async drainNotifications(): Promise<void> {
    const deadline = Date.now() + NOTIFICATION_DRAIN_TIMEOUT_MS;
    let quietSince = Date.now();

    while (Date.now() < deadline) {
      await sleep(Math.min(NOTIFICATION_DRAIN_QUIET_MS, deadline - Date.now()));
      await this.notificationQueue;
      if (this.lastSessionUpdateAt > quietSince) {
        quietSince = this.lastSessionUpdateAt;
        continue;
      }
      if (Date.now() - quietSince >= NOTIFICATION_DRAIN_QUIET_MS) return;
    }
  }

  private status(state: HeterogeneousAgentRuntimeStatus['state']): void {
    this.options.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: Date.now(),
      operationId: this.options.operationId,
      sessionId: this.options.sessionId,
      state,
      transport: TRANSPORT,
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: Error): void {
    this.fatalError ??= error;
    this.rejectPending(error);
  }

  private shutdown(signal: NodeJS.Signals): void {
    if (this.interruptTimer) clearTimeout(this.interruptTimer);
    const child = this.child;
    this.child = undefined;
    if (!child?.pid || child.killed) return;
    try {
      process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  }
}
