import type { HeterogeneousAgentModel } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import { ACP_PROTOCOL_VERSION, AcpAgentSession } from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpRpcResponseError, AcpServerRequestError } from './acpStdioClient';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { normalizeImage } from './input';

const NOTIFICATION_DRAIN_QUIET_MS = 250;
const NOTIFICATION_DRAIN_TIMEOUT_MS = 2000;
const TRANSPORT = 'droid-acp' as const;

const DROID_ACP_VALUE_ARGS = new Set([
  '--additional-tools',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--disabled-tools',
  '--enabled-tools',
  '--log-group-id',
  '--restrict-tools',
  '--tag',
]);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface DroidAcpTextPromptBlock {
  text: string;
  type: 'text';
}

export interface DroidAcpImagePromptBlock {
  data: string;
  mimeType: string;
  type: 'image';
}

export type DroidAcpPromptBlock = DroidAcpImagePromptBlock | DroidAcpTextPromptBlock;

/**
 * Build the fixed Droid ACP invocation while keeping prompt/session/framing and
 * permission policy under protocol control. Only additive tool/system options
 * are accepted; execution, model, cwd, resume, and unsafe permission flags must
 * never be able to override the host's ACP lifecycle.
 */
export const buildDroidAcpArgs = (extraArgs: string[] = []): string[] => {
  const safeArgs: string[] = [];

  for (let index = 0; index < extraArgs.length; index += 1) {
    const argument = extraArgs[index]!;
    const separatorIndex = argument.indexOf('=');
    const flag = separatorIndex < 0 ? argument : argument.slice(0, separatorIndex);
    if (!DROID_ACP_VALUE_ARGS.has(flag)) {
      throw new Error(`Factory Droid ACP does not support CLI argument: ${argument}`);
    }

    if (separatorIndex < 0) {
      const value = extraArgs[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Factory Droid ACP argument requires a value: ${argument}`);
      }
      safeArgs.push(argument, value);
      index += 1;
    } else {
      if (!argument.slice(separatorIndex + 1)) {
        throw new Error(`Factory Droid ACP argument requires a value: ${flag}`);
      }
      safeArgs.push(argument);
    }
  }

  return ['exec', '--output-format', 'acp', ...safeArgs];
};

export const buildDroidAcpPrompt = async (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<DroidAcpPromptBlock[]> => {
  const blocks = typeof prompt === 'string' ? [{ text: prompt, type: 'text' as const }] : prompt;
  const result: DroidAcpPromptBlock[] = [];
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

interface DroidAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
    sessionCapabilities?: { close?: unknown };
  };
  protocolVersion?: number;
}

interface DroidAcpSessionResult {
  configOptions?: unknown;
  sessionId?: string;
}

interface DroidAcpPromptResult {
  stopReason?: string;
}

interface DroidAcpConfigOption {
  category?: unknown;
  currentValue?: unknown;
  id?: unknown;
  name?: unknown;
  options?: unknown;
  type?: unknown;
  value?: unknown;
}

interface DroidAcpSetConfigOptionResult {
  configOptions?: unknown;
}

interface DroidAcpPermissionOption {
  kind: string;
  name: string;
  optionId: string;
}

interface DroidAcpPermissionRequest {
  options: DroidAcpPermissionOption[];
  toolCall: {
    title: string;
    toolCallId: string;
  };
}

export interface DroidAcpModelCatalog {
  configId: string;
  currentModelId?: string;
  models: HeterogeneousAgentModel[];
}

export interface ListDroidAcpModelsOptions {
  args?: string[];
  clientVersion?: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const toDroidModel = (id: string, name: unknown): HeterogeneousAgentModel => ({
  id,
  ...(typeof name === 'string' && name && name !== id ? { label: name } : {}),
  modelId: id,
  providerId: 'droid',
});

/** Read Droid's model selector from the standard ACP config-options response. */
export const parseDroidAcpModelCatalog = (
  result: Pick<DroidAcpSessionResult, 'configOptions'> | null | undefined,
): DroidAcpModelCatalog | undefined => {
  const configOptions = Array.isArray(result?.configOptions)
    ? result.configOptions.map((value) => value as DroidAcpConfigOption | null)
    : [];
  const selectableOptions = configOptions.filter((option) => option?.type === 'select');
  const modelConfig =
    selectableOptions.find((option) => option?.category === 'model') ??
    selectableOptions.find((option) => option?.id === 'model') ??
    selectableOptions.find(
      (option) => typeof option?.name === 'string' && option.name.toLowerCase() === 'model',
    );
  if (!modelConfig || typeof modelConfig.id !== 'string' || !modelConfig.id) return;

  const values = Array.isArray(modelConfig.options) ? modelConfig.options : [];
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];
  for (const value of values) {
    const option = value as DroidAcpConfigOption | null;
    if (typeof option?.value !== 'string' || !option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    models.push(toDroidModel(option.value, option.name));
  }

  return {
    configId: modelConfig.id,
    currentModelId:
      typeof modelConfig.currentValue === 'string' ? modelConfig.currentValue : undefined,
    models,
  };
};

export interface DroidAcpSessionOptions extends AcpAgentSessionOptions {
  askUserBridge?: AskUserBridge;
  initialModel?: string;
  inputOptions?: BuildAgentInputOptions;
  onModel?: (model: string) => void;
  prompt: AgentPromptInput | DroidAcpPromptBlock[];
}

/** Droid wraps every load failure alike, so only its nested not-found detail is recoverable. */
export const isDroidAcpSessionNotFoundError = (error: unknown): error is AcpRpcResponseError =>
  error instanceof AcpRpcResponseError &&
  error.method === 'session/load' &&
  error.rpcError.code === -32_603 &&
  error.rpcError.message === 'Failed to load session' &&
  isRecord(error.rpcError.data) &&
  typeof error.rpcError.data.details === 'string' &&
  /^Session .+ not found$/.test(error.rpcError.data.details);

/** Factory Droid's native ACP v1 lifecycle, including fail-closed permission requests. */
export class DroidAcpSession extends AcpAgentSession<
  DroidAcpInitializeResult,
  DroidAcpSessionOptions
> {
  private acceptUpdates = false;
  private lastSessionUpdateAt = 0;
  private modelDiscovery?: DroidAcpSession;
  private resolvedPrompt: DroidAcpPromptBlock[] = [];

  constructor(options: DroidAcpSessionOptions) {
    super(options, {
      args: buildDroidAcpArgs(options.args),
      pipeline: { agentType: 'droid' },
      processLabel: 'Factory Droid ACP',
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

  private async discoverModelCatalog(): Promise<DroidAcpModelCatalog> {
    try {
      const initialized = await this.initializeConnection();
      const sessionResult = await this.client.request<DroidAcpSessionResult>('session/new', {
        cwd: this.options.cwd,
        mcpServers: [],
      });
      if (!sessionResult?.sessionId) throw new Error('Factory Droid ACP returned no session id');
      const catalog = parseDroidAcpModelCatalog(sessionResult);
      if (!catalog) {
        throw new Error('Factory Droid ACP did not expose a model configuration option');
      }
      if (initialized?.agentCapabilities?.sessionCapabilities?.close) {
        await this.client.request('session/close', { sessionId: sessionResult.sessionId });
      }
      return catalog;
    } finally {
      this.client.close();
    }
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

  protected validateInitialized(initialized: DroidAcpInitializeResult): void {
    if (
      typeof initialized?.protocolVersion === 'number' &&
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION
    ) {
      throw new Error(
        `Factory Droid ACP returned unsupported protocol version: ${initialized.protocolVersion}`,
      );
    }
  }

  protected async establishSession(initialized: DroidAcpInitializeResult): Promise<string> {
    if (
      this.resolvedPrompt.some((block) => block.type === 'image') &&
      initialized?.agentCapabilities?.promptCapabilities?.image !== true
    ) {
      throw new Error('Factory Droid ACP does not support image prompt blocks');
    }
    if (this.options.resumeSessionId && initialized?.agentCapabilities?.loadSession !== true) {
      throw new Error('Factory Droid ACP does not support loading sessions');
    }

    const sessionResult = await this.client.request<DroidAcpSessionResult>(
      this.options.resumeSessionId ? 'session/load' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(this.options.resumeSessionId ? { sessionId: this.options.resumeSessionId } : {}),
      },
    );
    const sessionId = sessionResult?.sessionId ?? this.options.resumeSessionId;
    if (!sessionId) throw new Error('Factory Droid ACP returned no session id');
    this.acpSessionId = sessionId;
    this.options.onSessionId(sessionId);

    const model = await this.applyInitialModel(sessionId, sessionResult);
    if (model) {
      this.pipeline.configureSession({ model });
      this.options.onModel?.(model);
    }
    await this.pushToPipeline({ model, sessionId, type: 'droid_session' });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    // A loaded session may replay historical updates before returning. Keep
    // setup traffic gated until the new prompt is about to start.
    this.acceptUpdates = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: this.resolvedPrompt, sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.drainNotifications();
    await this.client.drain();
    await this.pushToPipeline({
      stopReason: (result as DroidAcpPromptResult | undefined)?.stopReason,
      type: 'droid_prompt_completed',
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    this.options.askUserBridge?.cancelAll('session_ended');
    await this.pushToPipeline({ message: error.message, type: 'droid_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected onHostClose(): void {
    this.options.askUserBridge?.cancelAll('session_ended');
    this.modelDiscovery?.close();
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update' || !this.acceptUpdates) return;

    this.lastSessionUpdateAt = Date.now();
    const update = (message.params as { update?: unknown } | undefined)?.update;
    if (!isRecord(update)) return;

    if (update.sessionUpdate === 'config_option_update') {
      const catalog = parseDroidAcpModelCatalog({ configOptions: update.configOptions });
      if (catalog?.currentModelId) {
        this.pipeline.configureSession({ model: catalog.currentModelId });
        this.options.onModel?.(catalog.currentModelId);
      }
    }
    await this.pushToPipeline(update);
  }

  protected async handleServerRequest(message: AcpRpcMessage): Promise<unknown> {
    if (message.method === 'session/request_permission') {
      const request = this.parsePermissionRequest(message.params);
      return this.requestPermission(
        request,
        this.buildInterventionToolCallId(message, request.toolCall.toolCallId),
      );
    }
    throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
  }

  private async resolvePrompt(): Promise<DroidAcpPromptBlock[]> {
    const prompt = this.options.prompt;
    if (
      Array.isArray(prompt) &&
      prompt.every(
        (block) =>
          'type' in block && (block.type === 'text' || ('data' in block && block.type === 'image')),
      )
    ) {
      return prompt as DroidAcpPromptBlock[];
    }
    return buildDroidAcpPrompt(prompt as AgentPromptInput, this.options.inputOptions);
  }

  private async applyInitialModel(
    sessionId: string,
    sessionResult: DroidAcpSessionResult,
  ): Promise<string | undefined> {
    let catalog = parseDroidAcpModelCatalog(sessionResult);
    const requestedModel = this.options.initialModel?.trim();
    if (!requestedModel || requestedModel === 'default') return catalog?.currentModelId;
    if (!catalog && this.options.resumeSessionId) {
      catalog = await this.discoverResumeModelCatalog();
    }
    if (!catalog) {
      throw new Error('Factory Droid ACP did not expose a model configuration option');
    }

    const selected = catalog.models.find(
      (model) => model.id === requestedModel || model.label === requestedModel,
    );
    if (!selected) throw new Error(`Factory Droid ACP model is unavailable: ${requestedModel}`);

    const response = await this.client.request<DroidAcpSetConfigOptionResult>(
      'session/set_config_option',
      {
        configId: catalog.configId,
        sessionId,
        value: selected.id,
      },
    );
    return (
      parseDroidAcpModelCatalog({ configOptions: response?.configOptions })?.currentModelId ??
      selected.id
    );
  }

  private async discoverResumeModelCatalog(): Promise<DroidAcpModelCatalog> {
    const discovery = new DroidAcpSession({
      ...this.options,
      askUserBridge: undefined,
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

  private parsePermissionRequest(value: unknown): DroidAcpPermissionRequest {
    if (!isRecord(value) || !Array.isArray(value.options) || !isRecord(value.toolCall)) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission request');
    }

    const options = value.options.flatMap((option) => {
      if (
        !isRecord(option) ||
        typeof option.kind !== 'string' ||
        option.kind.length === 0 ||
        option.kind.length > 1000 ||
        typeof option.name !== 'string' ||
        option.name.length === 0 ||
        option.name.length > 200 ||
        typeof option.optionId !== 'string' ||
        option.optionId.length === 0 ||
        option.optionId.length > 200
      ) {
        return [];
      }
      return [{ kind: option.kind, name: option.name, optionId: option.optionId }];
    });
    const optionIds = new Set(options.map(({ optionId }) => optionId));
    if (
      options.length !== value.options.length ||
      options.length === 0 ||
      optionIds.size !== options.length ||
      typeof value.toolCall.toolCallId !== 'string' ||
      value.toolCall.toolCallId.length === 0 ||
      typeof value.toolCall.title !== 'string'
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission options');
    }

    const title = value.toolCall.title.trim().slice(0, 4000);

    return {
      options,
      toolCall: {
        title: title || 'Factory Droid requests permission',
        toolCallId: value.toolCall.toolCallId,
      },
    };
  }

  private async requestPermission(
    request: DroidAcpPermissionRequest,
    interventionToolCallId: string,
  ): Promise<unknown> {
    const bridge = this.options.askUserBridge;
    if (!bridge) return { outcome: { outcome: 'cancelled' } };

    const question = request.toolCall.title;
    const arguments_ = {
      questions: [
        {
          header: 'Droid permission',
          multiSelect: false,
          options: request.options.map(({ kind, name, optionId }) => ({
            description: kind,
            id: optionId,
            label: name,
          })),
          question,
        },
      ],
    };
    await this.pushToPipeline({
      identifier: 'droid',
      rawInput: arguments_,
      sessionUpdate: 'tool_call',
      title: 'askUserQuestion',
      toolCallId: interventionToolCallId,
    });
    const answer = await bridge.pending({
      arguments: arguments_,
      interactionKind: 'permission',
      toolCallId: interventionToolCallId,
    });
    await this.pushToPipeline({
      rawOutput: answer,
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId: interventionToolCallId,
    });

    const selections = this.getAnswerSelections(answer, question);
    const selected = request.options.find(({ optionId }) => selections.includes(optionId));
    return selected
      ? { outcome: { optionId: selected.optionId, outcome: 'selected' } }
      : { outcome: { outcome: 'cancelled' } };
  }

  private buildInterventionToolCallId(message: AcpRpcMessage, sourceToolCallId: string): string {
    return `droid-permission-${String(message.id)}-${sourceToolCallId}`;
  }

  private getAnswerSelections(answer: InterventionAnswer, question: string): string[] {
    if (answer.cancelled || !isRecord(answer.result)) return [];
    const rawSelection = answer.result[question];
    return (Array.isArray(rawSelection) ? rawSelection : [rawSelection]).flatMap((selection) =>
      typeof selection === 'string' ? [selection] : [],
    );
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

export const listDroidAcpModels = async (
  options: ListDroidAcpModelsOptions,
): Promise<HeterogeneousAgentModel[]> =>
  new DroidAcpSession({
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
    operationId: 'droid-model-discovery',
    prompt: '',
    requestTimeoutMs: options.timeoutMs,
    sessionId: 'droid-model-discovery',
  }).discoverModels();
