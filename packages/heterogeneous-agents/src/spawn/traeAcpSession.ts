import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import type { HeterogeneousAgentModel } from '@lobechat/types';

import type { AcpRpcMessage } from './acpStdioClient';
import { AcpServerRequestError, AcpStdioClient } from './acpStdioClient';
import { AgentStreamPipeline } from './agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from './claudeAgentSdkSession';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { normalizeImage } from './input';

const ACP_PROTOCOL_VERSION = 1;
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

interface TraeAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
    sessionCapabilities?: { close?: unknown };
  };
  protocolVersion?: number;
}

interface TraeAcpSessionResult {
  configOptions?: unknown;
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

interface TraeAcpConfigOption {
  category?: unknown;
  currentValue?: unknown;
  id?: unknown;
  name?: unknown;
  options?: unknown;
  type?: unknown;
  value?: unknown;
}

interface TraeAcpSetConfigOptionResult {
  configOptions?: unknown;
}

interface TraeAcpPermissionOption {
  kind?: unknown;
  optionId?: unknown;
}

export interface TraeAcpModelCatalog {
  configId?: string;
  currentModelId?: string;
  models: HeterogeneousAgentModel[];
  protocol: 'config-option' | 'legacy-model';
}

export interface ListTraeAcpModelsOptions {
  args?: string[];
  clientVersion?: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const toTraeModel = (id: string, name: unknown): HeterogeneousAgentModel => ({
  id,
  ...(typeof name === 'string' && name && name !== id ? { label: name } : {}),
  modelId: id,
  providerId: 'trae',
});

const parseConfigOptionModels = (options: unknown): HeterogeneousAgentModel[] => {
  if (!Array.isArray(options)) return [];

  const values = options.flatMap((value) => {
    const option = value as TraeAcpConfigOption | null;
    return Array.isArray(option?.options) ? option.options : [value];
  });
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];
  for (const value of values) {
    const option = value as TraeAcpConfigOption | null;
    if (typeof option?.value !== 'string' || !option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    models.push(toTraeModel(option.value, option.name));
  }
  return models;
};

/**
 * Read model selection from the current stable ACP config-options API, with a
 * compatibility fallback for the never-stabilized dedicated model API still
 * exposed by older TRAE CLI builds.
 */
export const parseTraeAcpModelCatalog = (
  result: Pick<TraeAcpSessionResult, 'configOptions' | 'models'> | null | undefined,
): TraeAcpModelCatalog | undefined => {
  const configOptions = Array.isArray(result?.configOptions)
    ? result.configOptions.map((value) => value as TraeAcpConfigOption | null)
    : [];
  const selectableOptions = configOptions.filter((option) => option?.type === 'select');
  const modelConfig =
    selectableOptions.find((option) => option?.category === 'model') ??
    selectableOptions.find((option) => option?.id === 'model') ??
    selectableOptions.find(
      (option) => typeof option?.name === 'string' && option.name.toLowerCase() === 'model',
    );
  if (modelConfig && typeof modelConfig.id === 'string' && modelConfig.id) {
    return {
      configId: modelConfig.id,
      currentModelId:
        typeof modelConfig.currentValue === 'string' ? modelConfig.currentValue : undefined,
      models: parseConfigOptionModels(modelConfig.options),
      protocol: 'config-option',
    };
  }

  if (!Array.isArray(result?.models?.availableModels)) return;
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];
  for (const value of result.models.availableModels) {
    const option = value as TraeAcpModelOption | null;
    if (typeof option?.modelId !== 'string' || !option.modelId || seen.has(option.modelId))
      continue;
    seen.add(option.modelId);
    models.push(toTraeModel(option.modelId, option.name));
  }
  return {
    currentModelId:
      typeof result.models.currentModelId === 'string' ? result.models.currentModelId : undefined,
    models,
    protocol: 'legacy-model',
  };
};

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
  requestTimeoutMs?: number;
  resumeSessionId?: string;
  sessionId: string;
}

export class TraeAcpSession {
  private readonly client: AcpStdioClient;
  private readonly pipeline: AgentStreamPipeline;
  private acceptUpdates = false;
  private closedByHost = false;
  private interruptTimer?: ReturnType<typeof setTimeout>;
  private lastSessionUpdateAt = 0;
  private modelDiscovery?: TraeAcpSession;
  private session?: string;

  constructor(private readonly options: TraeAcpSessionOptions) {
    this.pipeline = new AgentStreamPipeline({
      agentType: 'trae',
      operationId: options.operationId,
    });
    this.client = new AcpStdioClient({
      args: buildTraeAcpArgs(options.args),
      commandPath: options.commandPath,
      cwd: options.cwd,
      env: options.env,
      onMessage: (message) => this.handleRpcMessage(message),
      onRawMessage: options.onRawMessage,
      onServerRequest: (message) => this.handleServerRequest(message),
      onStderr: options.onStderr,
      processLabel: 'TRAE ACP',
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  get nativeSessionId(): string | undefined {
    return this.session;
  }

  get pid(): number | undefined {
    return this.client.pid;
  }

  async run(): Promise<void> {
    this.status('starting');
    try {
      const prompt = await this.resolvePrompt();
      const initialized = await this.initialize();
      if (
        prompt.some((block) => block.type === 'image') &&
        initialized?.agentCapabilities?.promptCapabilities?.image !== true
      ) {
        throw new Error('TRAE ACP agent does not support image prompt blocks');
      }
      if (this.options.resumeSessionId && initialized?.agentCapabilities?.loadSession !== true) {
        throw new Error('TRAE ACP agent does not support loading sessions');
      }

      const sessionResult = await this.client.request<TraeAcpSessionResult>(
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

      const model = await this.applyInitialModel(sessionId, sessionResult);
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
      const response = await this.client.request<TraeAcpPromptResult>(
        'session/prompt',
        { prompt, sessionId },
        false,
      );
      await this.drainNotifications();
      await this.client.drain();
      await this.emit({ stopReason: response?.stopReason, type: 'trae_prompt_completed' });
      await this.emitEvents(await this.pipeline.flush());
      this.status('idle');
    } catch (cause) {
      if (this.closedByHost) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.emit({ message: error.message, type: 'trae_error' });
      await this.emitEvents(await this.pipeline.flush());
      throw error;
    } finally {
      if (this.interruptTimer) clearTimeout(this.interruptTimer);
      this.client.close();
      this.status('closed');
    }
  }

  /** Create a short-lived ACP session and read its agent-provided model selector. */
  async discoverModels(): Promise<HeterogeneousAgentModel[]> {
    return (await this.discoverModelCatalog()).models;
  }

  private async discoverModelCatalog(): Promise<TraeAcpModelCatalog> {
    try {
      const initialized = await this.initialize();
      const sessionResult = await this.client.request<TraeAcpSessionResult>('session/new', {
        cwd: this.options.cwd,
        mcpServers: [],
      });
      if (!sessionResult?.sessionId) throw new Error('TRAE ACP returned no session id');

      const catalog = parseTraeAcpModelCatalog(sessionResult);
      if (!catalog) throw new Error('TRAE ACP did not expose a model configuration option');

      if (initialized?.agentCapabilities?.sessionCapabilities?.close) {
        await this.client.request('session/close', { sessionId: sessionResult.sessionId });
      }
      return catalog;
    } finally {
      this.client.close();
    }
  }

  async interrupt(): Promise<void> {
    if (!this.session) {
      this.close();
      return;
    }
    this.client.notify('session/cancel', { sessionId: this.session });
    this.interruptTimer = setTimeout(() => this.close(), 2000);
    this.interruptTimer.unref?.();
  }

  close(): void {
    this.closedByHost = true;
    this.modelDiscovery?.close();
    this.client.close();
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

  private async initialize(): Promise<TraeAcpInitializeResult> {
    await this.client.start();
    const initialized = await this.client.request<TraeAcpInitializeResult>('initialize', {
      clientCapabilities: {},
      clientInfo: {
        name: 'lobehub',
        title: 'LobeHub',
        version: this.options.clientVersion,
      },
      protocolVersion: ACP_PROTOCOL_VERSION,
    });
    if (
      typeof initialized?.protocolVersion === 'number' &&
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION
    ) {
      throw new Error(
        `TRAE ACP returned unsupported protocol version: ${initialized.protocolVersion}`,
      );
    }
    return initialized;
  }

  private async handleRpcMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update') return;
    const suppress = !this.acceptUpdates;
    if (suppress) return;

    this.lastSessionUpdateAt = Date.now();
    const update = (message.params as { update?: unknown } | undefined)?.update;
    if (!update || typeof update !== 'object') return;

    if ((update as { sessionUpdate?: unknown }).sessionUpdate === 'config_option_update') {
      const catalog = parseTraeAcpModelCatalog({
        configOptions: (update as { configOptions?: unknown }).configOptions,
      });
      if (catalog?.currentModelId) {
        this.pipeline.configureSession({ model: catalog.currentModelId });
        this.options.onModel?.(catalog.currentModelId);
      }
    }
    await this.emit(update as Record<string, unknown>);
  }

  private handleServerRequest(message: AcpRpcMessage): unknown {
    if (message.method === 'session/request_permission') {
      const params = message.params as { options?: unknown } | undefined;
      const options = Array.isArray(params?.options)
        ? params.options.map((value) => value as TraeAcpPermissionOption | null)
        : [];
      const selected =
        options.find(
          (option) =>
            option?.optionId === 'allow_session' || option?.optionId === 'approve_for_session',
        ) ??
        options.find((option) => option?.kind === 'allow_once') ??
        options.find((option) => option?.kind === 'reject_once');
      if (typeof selected?.optionId === 'string') {
        return { outcome: { optionId: selected.optionId, outcome: 'selected' } };
      }
      throw new AcpServerRequestError(-32_603, 'No safe permission option was offered');
    }
    throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
  }

  private async emit(payload: Record<string, unknown>): Promise<void> {
    await this.emitEvents(await this.pipeline.push(`${JSON.stringify(payload)}\n`));
  }

  private async emitEvents(events: AgentStreamEvent[]): Promise<void> {
    if (events.length) await this.options.onEvents(events);
  }

  private async applyInitialModel(
    sessionId: string,
    sessionResult: TraeAcpSessionResult,
  ): Promise<string | undefined> {
    let catalog = parseTraeAcpModelCatalog(sessionResult);
    const requestedModel = this.options.initialModel?.trim();
    if (!requestedModel || requestedModel === 'default') return catalog?.currentModelId;
    if (!catalog && this.options.resumeSessionId) {
      catalog = await this.discoverResumeModelCatalog();
    }
    if (!catalog) throw new Error('TRAE ACP did not expose a model configuration option');

    const selected = catalog.models.find(
      (model) => model.id === requestedModel || model.label === requestedModel,
    );
    if (!selected) throw new Error(`TRAE ACP model is unavailable: ${requestedModel}`);

    if (catalog.protocol === 'config-option') {
      const response = await this.client.request<TraeAcpSetConfigOptionResult>(
        'session/set_config_option',
        {
          configId: catalog.configId,
          sessionId,
          value: selected.id,
        },
      );
      return (
        parseTraeAcpModelCatalog({ configOptions: response?.configOptions })?.currentModelId ??
        selected.id
      );
    }

    await this.client.request('session/set_model', { modelId: selected.id, sessionId });
    return selected.id;
  }

  private async discoverResumeModelCatalog(): Promise<TraeAcpModelCatalog> {
    const discovery = new TraeAcpSession({
      ...this.options,
      initialModel: undefined,
      onEvents: () => {},
      onModel: undefined,
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      operationId: `${this.options.operationId}-model-discovery`,
      prompt: '',
      resumeSessionId: undefined,
      sessionId: `${this.options.sessionId}-model-discovery`,
    });
    this.modelDiscovery = discovery;
    try {
      return await discovery.discoverModelCatalog();
    } finally {
      discovery.close();
      if (this.modelDiscovery === discovery) this.modelDiscovery = undefined;
    }
  }

  private async drainNotifications(): Promise<void> {
    const deadline = Date.now() + NOTIFICATION_DRAIN_TIMEOUT_MS;
    let quietSince = Date.now();

    while (Date.now() < deadline) {
      await sleep(Math.min(NOTIFICATION_DRAIN_QUIET_MS, deadline - Date.now()));
      await this.client.drain();
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
}

export const listTraeAcpModels = async (
  options: ListTraeAcpModelsOptions,
): Promise<HeterogeneousAgentModel[]> =>
  new TraeAcpSession({
    args: options.args ?? [],
    clientVersion: options.clientVersion ?? '1.0.0',
    commandPath: options.commandPath,
    cwd: options.cwd,
    env: options.env,
    onEvents: () => {},
    onRawMessage: () => {},
    onRuntimeStatus: () => {},
    onSessionId: () => {},
    onStderr: () => {},
    operationId: 'trae-model-discovery',
    prompt: '',
    requestTimeoutMs: options.timeoutMs,
    sessionId: 'trae-model-discovery',
  }).discoverModels();
