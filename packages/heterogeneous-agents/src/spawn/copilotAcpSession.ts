import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { HeterogeneousAgentModel } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import { ACP_PROTOCOL_VERSION, AcpAgentSession } from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpRpcResponseError, AcpServerRequestError } from './acpStdioClient';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import type {
  TraeAcpImagePromptBlock,
  TraeAcpPromptBlock,
  TraeAcpTextPromptBlock,
} from './traeAcpSession';
import { buildTraeAcpPrompt } from './traeAcpSession';

const NOTIFICATION_DRAIN_QUIET_MS = 250;
const NOTIFICATION_DRAIN_TIMEOUT_MS = 2000;
const TRANSPORT = 'copilot-acp' as const;
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type CopilotAcpTextPromptBlock = TraeAcpTextPromptBlock;
export type CopilotAcpImagePromptBlock = TraeAcpImagePromptBlock;
export type CopilotAcpPromptBlock = TraeAcpPromptBlock;

interface ExtractedCopilotSessionFlags {
  args: string[];
  model?: string;
  reasoningEffort?: string;
}

const extractCopilotSessionFlags = (extraArgs: string[] = []): ExtractedCopilotSessionFlags => {
  const args: string[] = [];
  let model: string | undefined;
  let reasoningEffort: string | undefined;

  for (let index = 0; index < extraArgs.length; index += 1) {
    const arg = extraArgs[index]!;
    if (arg === '--acp' || arg === '--stdio') {
      continue;
    }
    if (arg === '--model' || arg === '-m') {
      const value = extraArgs[index + 1];
      if (value && !value.startsWith('-')) {
        model = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--model=')) {
      model = arg.slice('--model='.length);
      continue;
    }
    if (arg.startsWith('-m=')) {
      model = arg.slice('-m='.length);
      continue;
    }
    if (arg === '--reasoning-effort') {
      const value = extraArgs[index + 1];
      if (value && !value.startsWith('-')) {
        reasoningEffort = value;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--reasoning-effort=')) {
      reasoningEffort = arg.slice('--reasoning-effort='.length);
      continue;
    }
    args.push(arg);
  }

  return { args, model, reasoningEffort };
};

export const buildCopilotAcpArgs = (extraArgs: string[] = []): string[] => {
  const { args } = extractCopilotSessionFlags(extraArgs);
  return ['--acp', '--stdio', ...args];
};

export const buildCopilotAcpPrompt = (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<CopilotAcpPromptBlock[]> => buildTraeAcpPrompt(prompt, options);

export const isCopilotAcpSessionNotFoundError = (error: unknown): error is AcpRpcResponseError => {
  if (!(error instanceof AcpRpcResponseError) || error.method !== 'session/load') return false;

  const data = isRecord(error.rpcError.data) ? error.rpcError.data : undefined;
  const details = typeof data?.details === 'string' ? data.details : '';
  const combined = `${error.rpcError.message} ${details}`;
  return /session\b[\s\S]*?\bnot found/i.test(combined);
};

interface CopilotAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
    sessionCapabilities?: { close?: unknown };
  };
  protocolVersion?: number | string;
}

interface CopilotAcpSessionResult {
  configOptions?: unknown;
  models?: {
    availableModels?: unknown;
    currentModelId?: unknown;
  };
  sessionId?: string;
}

interface CopilotAcpPromptResult {
  stopReason?: string;
  usage?: unknown;
}

interface CopilotAcpConfigOption {
  category?: unknown;
  currentValue?: unknown;
  id?: unknown;
  name?: unknown;
  options?: unknown;
  type?: unknown;
  value?: unknown;
}

interface CopilotAcpModelOption {
  modelId?: unknown;
  name?: unknown;
}

interface CopilotAcpSetConfigOptionResult {
  configOptions?: unknown;
}

interface CopilotAcpPermissionOption {
  kind: string;
  name: string;
  optionId: string;
}

interface CopilotAcpPermissionRequest {
  options: CopilotAcpPermissionOption[];
  toolCall: {
    title: string;
    toolCallId: string;
  };
}

export interface CopilotAcpModelCatalog {
  configId: string;
  currentModelId?: string;
  models: HeterogeneousAgentModel[];
}

interface CopilotAcpDiscoveredCatalog extends CopilotAcpModelCatalog {
  configOptions?: unknown;
}

export interface ListCopilotAcpModelsOptions {
  args?: string[];
  clientVersion?: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const toCopilotModel = (id: string, name: unknown): HeterogeneousAgentModel => ({
  id,
  ...(typeof name === 'string' && name && name !== id ? { label: name } : {}),
  modelId: id,
  providerId: 'copilot',
});

const parseConfigOptionModels = (options: unknown): HeterogeneousAgentModel[] => {
  if (!Array.isArray(options)) return [];

  const values = options.flatMap((value) => {
    const option = value as CopilotAcpConfigOption | null;
    return Array.isArray(option?.options) ? option.options : [value];
  });
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];
  for (const value of values) {
    const option = value as CopilotAcpConfigOption | null;
    if (typeof option?.value !== 'string' || !option.value || seen.has(option.value)) continue;
    seen.add(option.value);
    models.push(toCopilotModel(option.value, option.name));
  }
  return models;
};

const getReasoningEffortConfig = (configOptions: unknown): CopilotAcpConfigOption | undefined => {
  if (!Array.isArray(configOptions)) return undefined;
  return configOptions
    .map((value) => value as CopilotAcpConfigOption | null)
    .find(
      (option) =>
        option &&
        (option.id === 'reasoning_effort' || option.category === 'thought_level') &&
        (option.type === undefined || option.type === 'select'),
    ) as CopilotAcpConfigOption | undefined;
};

export const parseCopilotAcpModelCatalog = (
  result: Pick<CopilotAcpSessionResult, 'configOptions' | 'models'> | null | undefined,
): CopilotAcpModelCatalog | undefined => {
  const configOptions = Array.isArray(result?.configOptions)
    ? result.configOptions.map((value) => value as CopilotAcpConfigOption | null)
    : [];
  const selectableOptions = configOptions.filter(
    (option) => option?.type === undefined || option.type === 'select',
  );
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
    };
  }

  if (!Array.isArray(result?.models?.availableModels)) return undefined;
  const seen = new Set<string>();
  const models: HeterogeneousAgentModel[] = [];
  for (const value of result.models.availableModels) {
    const option = value as CopilotAcpModelOption | null;
    if (typeof option?.modelId !== 'string' || !option.modelId || seen.has(option.modelId))
      continue;
    seen.add(option.modelId);
    models.push(toCopilotModel(option.modelId, option.name));
  }
  return {
    configId: 'model',
    currentModelId:
      typeof result.models.currentModelId === 'string' ? result.models.currentModelId : undefined,
    models,
  };
};

const cleanupEmptyCopilotSessionDir = async (sessionId: string): Promise<void> => {
  if (!UUID_RE.test(sessionId)) return;
  const sessionDir = path.join(os.homedir(), '.copilot', 'session-state', sessionId);
  try {
    await fs.access(path.join(sessionDir, 'events.jsonl'));
  } catch {
    await fs.rm(sessionDir, { force: true, recursive: true }).catch(() => {});
  }
};

export interface CopilotAcpSessionOptions extends AcpAgentSessionOptions {
  askUserBridge?: AskUserBridge;
  initialModel?: string;
  inputOptions?: BuildAgentInputOptions;
  onModel?: (model: string) => void;
  prompt: AgentPromptInput | CopilotAcpPromptBlock[];
  reasoningEffort?: string;
}

export class CopilotAcpSession extends AcpAgentSession<
  CopilotAcpInitializeResult,
  CopilotAcpSessionOptions
> {
  private acceptUpdates = false;
  private lastSessionUpdateAt = 0;
  private modelDiscovery?: CopilotAcpSession;
  private readonly modelFromArgs?: string;
  private readonly reasoningEffort?: string;
  private resolvedPrompt: CopilotAcpPromptBlock[] = [];

  constructor(options: CopilotAcpSessionOptions) {
    const extracted = extractCopilotSessionFlags(options.args);
    super(options, {
      args: ['--acp', '--stdio', ...extracted.args],
      pipeline: { agentType: 'copilot', cwd: options.cwd },
      processLabel: 'GitHub Copilot ACP',
      transport: TRANSPORT,
    });
    this.modelFromArgs = extracted.model;
    this.reasoningEffort = options.reasoningEffort ?? extracted.reasoningEffort;
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  async discoverModels(): Promise<HeterogeneousAgentModel[]> {
    return (await this.discoverModelCatalog()).models;
  }

  protected async prepareRun(): Promise<void> {
    this.resolvedPrompt = await this.resolvePrompt();
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: {
        name: 'lobehub',
        title: 'LobeHub',
        version: this.options.clientVersion,
      },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: CopilotAcpInitializeResult): void {
    if (
      initialized?.protocolVersion !== undefined &&
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `GitHub Copilot ACP returned unsupported protocol version: ${String(initialized?.protocolVersion)}`,
      );
    }
  }

  protected async establishSession(initialized: CopilotAcpInitializeResult): Promise<string> {
    if (
      this.resolvedPrompt.some((block) => block.type === 'image') &&
      initialized?.agentCapabilities?.promptCapabilities?.image !== true
    ) {
      throw new Error('GitHub Copilot ACP does not support image prompt blocks');
    }
    if (this.options.resumeSessionId && initialized?.agentCapabilities?.loadSession !== true) {
      throw new Error('GitHub Copilot ACP does not support loading sessions');
    }

    const sessionResult = await this.client.request<CopilotAcpSessionResult>(
      this.options.resumeSessionId ? 'session/load' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(this.options.resumeSessionId ? { sessionId: this.options.resumeSessionId } : {}),
      },
    );
    const sessionId = sessionResult?.sessionId ?? this.options.resumeSessionId;
    if (!sessionId) throw new Error('GitHub Copilot ACP returned no session id');
    this.acpSessionId = sessionId;
    this.options.onSessionId(sessionId);

    const { configOptions, hasSessionConfigOptions, model } = await this.applyInitialModel(
      sessionId,
      sessionResult,
    );
    await this.applyReasoningEffort(sessionId, configOptions, hasSessionConfigOptions);

    if (model) {
      this.pipeline.configureSession({ model });
      this.options.onModel?.(model);
    }
    await this.pushToPipeline({ model, sessionId, type: 'copilot_session' });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    this.acceptUpdates = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: this.resolvedPrompt, sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.drainNotifications();
    await this.client.drain();
    const promptResult = isRecord(result) ? (result as CopilotAcpPromptResult) : undefined;
    await this.pushToPipeline({
      stopReason: promptResult?.stopReason,
      type: 'copilot_prompt_completed',
      usage: promptResult?.usage,
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    this.options.askUserBridge?.cancelAll('session_ended');
    const detail =
      error instanceof AcpRpcResponseError &&
      isRecord(error.rpcError.data) &&
      typeof error.rpcError.data.details === 'string' &&
      error.rpcError.data.details
        ? `${error.message}: ${error.rpcError.data.details}`
        : error.message;
    await this.pushToPipeline({ message: detail, type: 'copilot_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async onRunCancelled(): Promise<void> {
    this.options.askUserBridge?.cancelAll('session_ended');
    await this.pushToPipeline({ stopReason: 'cancelled', type: 'copilot_prompt_completed' });
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
      const catalog = parseCopilotAcpModelCatalog({ configOptions: update.configOptions });
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

  private async discoverModelCatalog(): Promise<CopilotAcpDiscoveredCatalog> {
    let discoverySessionId: string | undefined;
    try {
      const initialized = await this.initializeConnection();
      const sessionResult = await this.client.request<CopilotAcpSessionResult>('session/new', {
        cwd: this.options.cwd,
        mcpServers: [],
      });
      if (!sessionResult?.sessionId) throw new Error('GitHub Copilot ACP returned no session id');
      discoverySessionId = sessionResult.sessionId;
      const catalog = parseCopilotAcpModelCatalog(sessionResult);
      if (!catalog) {
        throw new Error('GitHub Copilot ACP did not expose a model configuration option');
      }
      if (initialized?.agentCapabilities?.sessionCapabilities?.close) {
        await this.client.request('session/close', { sessionId: sessionResult.sessionId });
      }
      return { ...catalog, configOptions: sessionResult.configOptions };
    } finally {
      this.client.close();
      if (discoverySessionId) {
        await cleanupEmptyCopilotSessionDir(discoverySessionId);
      }
    }
  }

  private async resolvePrompt(): Promise<CopilotAcpPromptBlock[]> {
    const prompt = this.options.prompt;
    if (
      Array.isArray(prompt) &&
      prompt.every(
        (block) =>
          'type' in block && (block.type === 'text' || ('data' in block && block.type === 'image')),
      )
    ) {
      return prompt as CopilotAcpPromptBlock[];
    }
    return buildCopilotAcpPrompt(prompt as AgentPromptInput, this.options.inputOptions);
  }

  private hasRequestedReasoningEffort(): boolean {
    const requestedEffort = this.reasoningEffort?.trim();
    return Boolean(requestedEffort && requestedEffort !== 'default');
  }

  private async applyInitialModel(
    sessionId: string,
    sessionResult: CopilotAcpSessionResult,
  ): Promise<{ configOptions: unknown; hasSessionConfigOptions: boolean; model?: string }> {
    const hasLoadedConfigOptions = Array.isArray(sessionResult?.configOptions);
    const sessionCatalog = parseCopilotAcpModelCatalog(sessionResult);
    let catalog: CopilotAcpDiscoveredCatalog | undefined = sessionCatalog;
    const requestedModel = (this.options.initialModel?.trim() || this.modelFromArgs?.trim()) ?? '';
    if (!requestedModel || requestedModel === 'default') {
      const currentModelId = sessionCatalog?.currentModelId;
      if (
        this.options.resumeSessionId &&
        sessionCatalog &&
        currentModelId &&
        currentModelId !== 'auto' &&
        !getReasoningEffortConfig(sessionResult.configOptions)
      ) {
        const response = await this.resetLoadedModelWithoutReasoningEffort(
          sessionId,
          sessionCatalog.configId,
          currentModelId,
        );
        const nextConfigOptions = response?.configOptions ?? sessionResult.configOptions;
        return {
          configOptions: nextConfigOptions,
          hasSessionConfigOptions: Array.isArray(nextConfigOptions),
          model: currentModelId,
        };
      }
      if (!sessionCatalog && this.options.resumeSessionId && this.hasRequestedReasoningEffort()) {
        catalog = await this.discoverResumeModelCatalog();
        return {
          configOptions: catalog.configOptions,
          hasSessionConfigOptions: false,
          model: currentModelId,
        };
      }
      return {
        configOptions: sessionResult.configOptions,
        hasSessionConfigOptions: hasLoadedConfigOptions,
        model: currentModelId,
      };
    }
    if (!catalog && this.options.resumeSessionId) {
      catalog = await this.discoverResumeModelCatalog();
    }
    if (!catalog) {
      throw new Error('GitHub Copilot ACP did not expose a model configuration option');
    }

    const selected = catalog.models.find(
      (model) => model.id === requestedModel || model.label === requestedModel,
    );
    if (!selected) throw new Error(`GitHub Copilot ACP model is unavailable: ${requestedModel}`);

    if (sessionCatalog?.currentModelId === selected.id) {
      if (
        this.options.resumeSessionId &&
        selected.id !== 'auto' &&
        !getReasoningEffortConfig(sessionResult.configOptions)
      ) {
        const response = await this.resetLoadedModelWithoutReasoningEffort(
          sessionId,
          sessionCatalog.configId,
          selected.id,
        );
        const nextConfigOptions = response?.configOptions ?? sessionResult.configOptions;
        return {
          configOptions: nextConfigOptions,
          hasSessionConfigOptions: Array.isArray(nextConfigOptions),
          model: selected.id,
        };
      }
      return {
        configOptions: sessionResult.configOptions,
        hasSessionConfigOptions: hasLoadedConfigOptions,
        model: selected.id,
      };
    }

    const response = await this.client.request<CopilotAcpSetConfigOptionResult>(
      'session/set_config_option',
      {
        configId: catalog.configId,
        sessionId,
        value: selected.id,
      },
    );
    const nextConfigOptions =
      response?.configOptions ?? sessionResult.configOptions ?? catalog.configOptions;
    return {
      configOptions: nextConfigOptions,
      hasSessionConfigOptions: Array.isArray(response?.configOptions) || hasLoadedConfigOptions,
      model:
        parseCopilotAcpModelCatalog({ configOptions: response?.configOptions })?.currentModelId ??
        selected.id,
    };
  }

  /**
   * Copilot CLI `session/load` replays `session.start`'s `reasoningEffort` from
   * `events.jsonl` but ignores `reasoningEffort: null` in `session.model_change`.
   * Re-selecting the same model is a no-op, so bounce through `auto` and back to
   * clear stale reasoning effort on models that do not support it.
   */
  private async resetLoadedModelWithoutReasoningEffort(
    sessionId: string,
    configId: string,
    modelId: string,
  ): Promise<CopilotAcpSetConfigOptionResult | undefined> {
    await this.client.request<CopilotAcpSetConfigOptionResult>('session/set_config_option', {
      configId,
      sessionId,
      value: 'auto',
    });
    return this.client.request<CopilotAcpSetConfigOptionResult>('session/set_config_option', {
      configId,
      sessionId,
      value: modelId,
    });
  }

  private async applyReasoningEffort(
    sessionId: string,
    configOptions: unknown,
    hasSessionConfigOptions = true,
  ): Promise<void> {
    const requestedEffort = this.reasoningEffort?.trim();
    if (!requestedEffort || requestedEffort === 'default') return;

    const reasoningConfig =
      getReasoningEffortConfig(configOptions) ??
      (!hasSessionConfigOptions && this.options.resumeSessionId
        ? { id: 'reasoning_effort' }
        : undefined);
    if (!reasoningConfig || typeof reasoningConfig.id !== 'string' || !reasoningConfig.id) {
      return;
    }

    const availableValues = Array.isArray(reasoningConfig.options)
      ? reasoningConfig.options.flatMap((option) =>
          isRecord(option) && typeof option.value === 'string' && option.value
            ? [option.value]
            : [],
        )
      : [];
    const targetValue =
      availableValues.length === 0 || availableValues.includes(requestedEffort)
        ? requestedEffort
        : undefined;
    if (!targetValue || (hasSessionConfigOptions && reasoningConfig.currentValue === targetValue)) {
      return;
    }

    await this.client.request<CopilotAcpSetConfigOptionResult>('session/set_config_option', {
      configId: reasoningConfig.id,
      sessionId,
      value: targetValue,
    });
  }

  private async discoverResumeModelCatalog(): Promise<CopilotAcpDiscoveredCatalog> {
    const discovery = new CopilotAcpSession({
      ...this.options,
      askUserBridge: undefined,
      initialModel: undefined,
      onEvents: () => {},
      onModel: undefined,
      onRuntimeStatus: () => {},
      onSessionId: () => {},
      operationId: `${this.options.operationId}-model-discovery`,
      prompt: '',
      reasoningEffort: undefined,
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

  private parsePermissionRequest(value: unknown): CopilotAcpPermissionRequest {
    if (!isRecord(value) || !Array.isArray(value.options) || !isRecord(value.toolCall)) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission request');
    }

    const options = value.options.flatMap((option) => {
      if (
        !isRecord(option) ||
        typeof option.name !== 'string' ||
        option.name.length === 0 ||
        option.name.length > 200 ||
        typeof option.optionId !== 'string' ||
        option.optionId.length === 0 ||
        option.optionId.length > 200
      ) {
        return [];
      }
      const kind =
        typeof option.kind === 'string' && option.kind.length > 0 && option.kind.length <= 1000
          ? option.kind
          : option.optionId;
      return [{ kind, name: option.name, optionId: option.optionId }];
    });
    const optionIds = new Set(options.map(({ optionId }) => optionId));
    if (
      options.length !== value.options.length ||
      options.length === 0 ||
      optionIds.size !== options.length ||
      typeof value.toolCall.toolCallId !== 'string' ||
      value.toolCall.toolCallId.length === 0
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission options');
    }

    const rawTitle = typeof value.toolCall.title === 'string' ? value.toolCall.title.trim() : '';
    const rawInput = isRecord(value.toolCall.rawInput) ? value.toolCall.rawInput : undefined;
    const command = typeof rawInput?.command === 'string' ? rawInput.command.trim() : '';
    const combinedTitle =
      rawTitle && command && !rawTitle.includes(command)
        ? `${rawTitle} (\`${command}\`)`
        : rawTitle || command || 'GitHub Copilot requests permission';

    return {
      options,
      toolCall: {
        title: combinedTitle.slice(0, 4000),
        toolCallId: value.toolCall.toolCallId,
      },
    };
  }

  private async requestPermission(
    request: CopilotAcpPermissionRequest,
    interventionToolCallId: string,
  ): Promise<unknown> {
    const bridge = this.options.askUserBridge;
    if (!bridge) return { outcome: { outcome: 'cancelled' } };

    const question = request.toolCall.title;
    const arguments_ = {
      questions: [
        {
          header: 'GitHub Copilot permission',
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
      identifier: 'copilot',
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
    return `copilot-permission-${String(message.id)}-${sourceToolCallId}`;
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

export const listCopilotAcpModels = async (
  options: ListCopilotAcpModelsOptions,
): Promise<HeterogeneousAgentModel[]> =>
  new CopilotAcpSession({
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
    operationId: 'copilot-model-discovery',
    prompt: '',
    requestTimeoutMs: options.timeoutMs,
    sessionId: 'copilot-model-discovery',
  }).discoverModels();
