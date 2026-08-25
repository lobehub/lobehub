import type { HeterogeneousAgentModel } from '@lobechat/types';

import type { AcpAgentSessionOptions } from './acpAgentSession';
import {
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  selectAcpPermissionOption,
} from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpServerRequestError } from './acpStdioClient';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { normalizeImage } from './input';

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

export interface TraeAcpSessionOptions extends AcpAgentSessionOptions {
  initialModel?: string;
  inputOptions?: BuildAgentInputOptions;
  onModel?: (model: string) => void;
  prompt: AgentPromptInput | TraeAcpPromptBlock[];
}

/** TRAE's ACP v1 lifecycle: model config-options and legacy model API on the shared base. */
export class TraeAcpSession extends AcpAgentSession<
  TraeAcpInitializeResult,
  TraeAcpSessionOptions
> {
  private acceptUpdates = false;
  private lastSessionUpdateAt = 0;
  private modelDiscovery?: TraeAcpSession;
  private resolvedPrompt: TraeAcpPromptBlock[] = [];

  constructor(options: TraeAcpSessionOptions) {
    super(options, {
      args: buildTraeAcpArgs(options.args),
      pipeline: { agentType: 'trae' },
      processLabel: 'TRAE ACP',
      transport: TRANSPORT,
    });
  }

  get nativeSessionId(): string | undefined {
    return this.acpSessionId;
  }

  /** Create a short-lived ACP session and read its agent-provided model selector. */
  async discoverModels(): Promise<HeterogeneousAgentModel[]> {
    return (await this.discoverModelCatalog()).models;
  }

  protected async prepareRun(): Promise<void> {
    this.resolvedPrompt = await this.resolvePrompt();
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: {},
      clientInfo: {
        name: 'lobehub',
        title: 'LobeHub',
        version: this.options.clientVersion,
      },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: TraeAcpInitializeResult): void {
    if (
      typeof initialized?.protocolVersion === 'number' &&
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION
    ) {
      throw new Error(
        `TRAE ACP returned unsupported protocol version: ${initialized.protocolVersion}`,
      );
    }
  }

  protected async establishSession(initialized: TraeAcpInitializeResult): Promise<string> {
    if (
      this.resolvedPrompt.some((block) => block.type === 'image') &&
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
    this.acpSessionId = sessionId;
    this.options.onSessionId(sessionId);

    const model = await this.applyInitialModel(sessionId, sessionResult);
    if (model) {
      this.pipeline.configureSession({ model });
      this.options.onModel?.(model);
    }
    await this.pushToPipeline({
      model,
      sessionId,
      type: 'trae_session',
    });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    // session/load may replay historical updates before returning. Keep setup
    // notifications gated until the new prompt is about to start.
    this.acceptUpdates = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: this.resolvedPrompt, sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.drainNotifications();
    await this.client.drain();
    await this.pushToPipeline({
      stopReason: (result as TraeAcpPromptResult | undefined)?.stopReason,
      type: 'trae_prompt_completed',
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    await this.pushToPipeline({ message: error.message, type: 'trae_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected onHostClose(): void {
    this.modelDiscovery?.close();
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update') return;
    if (!this.acceptUpdates) return;

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
    await this.pushToPipeline(update as Record<string, unknown>);
  }

  protected handleServerRequest(message: AcpRpcMessage): unknown {
    if (message.method === 'session/request_permission') {
      const optionId = selectAcpPermissionOption(message.params, [
        (option) =>
          option.optionId === 'allow_session' || option.optionId === 'approve_for_session',
        (option) => option.kind === 'allow_once',
        (option) => option.kind === 'reject_once',
      ]);
      if (optionId) return { outcome: { optionId, outcome: 'selected' } };
      throw new AcpServerRequestError(-32_603, 'No safe permission option was offered');
    }
    throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
  }

  private async discoverModelCatalog(): Promise<TraeAcpModelCatalog> {
    try {
      const initialized = await this.initializeConnection();
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
