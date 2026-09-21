import { isRecord } from '@lobechat/utils/object';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import type { AgentPromptInput } from '../protocol';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import { ACP_PROTOCOL_VERSION, AcpAgentSession } from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpRpcResponseError, AcpServerRequestError } from './acpStdioClient';
import type { BuildAgentInputOptions } from './input';
import type {
  TraeAcpImagePromptBlock,
  TraeAcpPromptBlock,
  TraeAcpTextPromptBlock,
} from './traeAcpSession';
import { buildTraeAcpPrompt, parseTraeAcpModelCatalog } from './traeAcpSession';

const TRANSPORT = 'devin-acp' as const;

export type DevinAcpTextPromptBlock = TraeAcpTextPromptBlock;
export type DevinAcpImagePromptBlock = TraeAcpImagePromptBlock;
export type DevinAcpPromptBlock = TraeAcpPromptBlock;

interface DevinAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
  };
  protocolVersion?: number | string;
}

interface DevinAcpSessionResult {
  configOptions?: unknown;
  sessionId?: string;
}

interface DevinAcpSetConfigOptionResult {
  configOptions?: unknown;
}

interface DevinAcpPromptResult {
  stopReason?: string;
  /** ACP experimental `Usage` from `session/prompt` result. */
  usage?: unknown;
}

interface DevinAcpPermissionOption {
  name: string;
  optionId: string;
}

interface DevinAcpPermissionRequest {
  options: DevinAcpPermissionOption[];
  toolCall: {
    title: string;
    toolCallId: string;
  };
}

interface CanonicalAskQuestionArgs {
  questions: Array<{
    header: string;
    multiSelect: false;
    options: Array<{ id: string; label: string }>;
    question: string;
  }>;
}

export interface DevinAcpSessionOptions extends AcpAgentSessionOptions {
  askUserBridge?: AskUserBridge;
  initialModel?: string;
  onModel?: (model: string) => void;
  /** Devin ACP permission mode, applied via `session/set_config_option`. */
  permissionMode?: string;
  prompt: DevinAcpPromptBlock[];
}

export const buildDevinAcpArgs = (extraArgs: string[] = []): string[] => {
  const args = [...extraArgs];
  let resolvedMode: string | undefined;

  // A user-supplied --permission-mode in extraArgs wins and must be moved
  // before the `acp` subcommand, since it is a `devin` global option.
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--permission-mode') {
      resolvedMode = args[i + 1];
      args.splice(i, 2);
      break;
    }
    if (arg.startsWith('--permission-mode=')) {
      resolvedMode = arg.slice('--permission-mode='.length);
      args.splice(i, 1);
      break;
    }
  }

  if (!resolvedMode) return ['acp', ...args];
  return ['--permission-mode', resolvedMode, 'acp', ...args];
};

export const buildDevinAcpPrompt = (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<DevinAcpPromptBlock[]> => buildTraeAcpPrompt(prompt, options);

export const isDevinAcpSessionNotFoundError = (error: unknown): error is AcpRpcResponseError => {
  if (!(error instanceof AcpRpcResponseError) || error.method !== 'session/load') return false;

  const data = isRecord(error.rpcError.data) ? error.rpcError.data : undefined;
  return (
    error.rpcError.code === -32_016 &&
    (data?.['cognition.ai/errorKind'] === 'session_not_found' ||
      error.rpcError.message === 'Session not found')
  );
};

export class DevinAcpSession extends AcpAgentSession<
  DevinAcpInitializeResult,
  DevinAcpSessionOptions
> {
  private acceptUpdates = false;
  private readonly resolvedPermissionMode?: string;

  constructor(options: DevinAcpSessionOptions) {
    const devinArgs = buildDevinAcpArgs(options.args);
    super(options, {
      args: devinArgs,
      pipeline: { agentType: 'devin', cwd: options.cwd },
      processLabel: 'Devin ACP',
      transport: TRANSPORT,
    });
    this.resolvedPermissionMode =
      devinArgs[0] === '--permission-mode' ? devinArgs[1] : (options.permissionMode ?? undefined);
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
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

  protected validateInitialized(initialized: DevinAcpInitializeResult): void {
    if (
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `Devin ACP returned unsupported protocol version: ${String(initialized.protocolVersion)}`,
      );
    }
  }

  protected async establishSession(initialized: DevinAcpInitializeResult): Promise<string> {
    if (
      this.options.prompt.some((block) => block.type === 'image') &&
      initialized.agentCapabilities?.promptCapabilities?.image !== true
    ) {
      throw new Error('Devin ACP agent does not support image prompt blocks');
    }
    if (this.options.resumeSessionId && initialized.agentCapabilities?.loadSession !== true) {
      throw new Error('Devin ACP agent does not support loading sessions');
    }

    const sessionResult = await this.client.request<DevinAcpSessionResult>(
      this.options.resumeSessionId ? 'session/load' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(this.options.resumeSessionId ? { sessionId: this.options.resumeSessionId } : {}),
      },
    );
    const sessionId = sessionResult.sessionId ?? this.options.resumeSessionId;
    if (!sessionId) throw new Error('Devin ACP returned no session id');

    const model = await this.applyInitialModel(sessionId, sessionResult);
    if (this.resolvedPermissionMode) {
      await this.client.request<DevinAcpSetConfigOptionResult>('session/set_config_option', {
        configId: 'mode',
        sessionId,
        value: this.resolvedPermissionMode,
      });
      // Permission mode should not clobber the model selected above. The model
      // resolved from the model set_config_option is authoritative.
    }
    if (model) {
      this.pipeline.configureSession({ model });
      this.options.onModel?.(model);
    }
    this.options.onSessionId(sessionId);
    await this.pushToPipeline({ model, sessionId, type: 'devin_session' });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    this.acceptUpdates = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: this.options.prompt, sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.client.drain();
    const promptResult = isRecord(result) ? result : undefined;
    await this.pushToPipeline({
      stopReason: (promptResult as DevinAcpPromptResult | undefined)?.stopReason,
      type: 'devin_prompt_completed',
      usage: (promptResult as DevinAcpPromptResult | undefined)?.usage,
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    await this.pushToPipeline({ message: error.message, type: 'devin_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (!this.acceptUpdates || message.method !== 'session/update') return;
    const params = isRecord(message.params) ? message.params : undefined;
    if (!isRecord(params?.update)) return;

    const update = this.normalizeSessionUpdate(params.update);
    if (update.sessionUpdate === 'config_option_update') {
      const model = this.resolveCurrentModel(update.configOptions);
      if (model) {
        this.pipeline.configureSession({ model });
        this.options.onModel?.(model);
      }
    }
    await this.pushToPipeline(update);
  }

  protected async handleServerRequest(message: AcpRpcMessage): Promise<unknown> {
    if (message.method !== 'session/request_permission') {
      throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
    }

    const request = this.parsePermissionRequest(message.params);
    const selected = await this.selectPermissionOption(message, request);
    return {
      outcome: selected
        ? { optionId: selected.optionId, outcome: 'selected' }
        : { outcome: 'cancelled' },
    };
  }

  private normalizeSessionUpdate(update: Record<string, unknown>): Record<string, unknown> {
    if (typeof update.name === 'string') return update;
    const meta = isRecord(update._meta) ? update._meta : undefined;
    const inferenceToolName = meta?.['cognition.ai/inferenceToolName'];
    return typeof inferenceToolName === 'string' && inferenceToolName
      ? { ...update, name: inferenceToolName }
      : update;
  }

  private resolveCurrentModel(configOptions: unknown): string | undefined {
    return parseTraeAcpModelCatalog({ configOptions })?.currentModelId;
  }

  private async applyInitialModel(
    sessionId: string,
    sessionResult: DevinAcpSessionResult,
  ): Promise<string | undefined> {
    const requestedModel = this.options.initialModel?.trim();
    if (!requestedModel || requestedModel === 'default') {
      return this.resolveCurrentModel(sessionResult.configOptions);
    }

    const currentModel = this.resolveCurrentModel(sessionResult.configOptions);
    if (
      currentModel &&
      this.normalizeModelId(currentModel) === this.normalizeModelId(requestedModel)
    ) {
      return currentModel;
    }

    const catalog = parseTraeAcpModelCatalog({ configOptions: sessionResult.configOptions });
    if (!catalog) {
      return this.setModelOption(sessionId, requestedModel);
    }

    const selected = catalog.models.find((model) =>
      [model.id, model.label].some(
        (candidate) =>
          typeof candidate === 'string' &&
          this.normalizeModelId(candidate) === this.normalizeModelId(requestedModel),
      ),
    );

    if (!selected) {
      throw new Error(`Devin ACP model is unavailable: ${requestedModel}`);
    }

    return this.setModelOption(sessionId, selected.id);
  }

  private async setModelOption(sessionId: string, value: string): Promise<string | undefined> {
    const setResult = await this.client.request<DevinAcpSetConfigOptionResult>(
      'session/set_config_option',
      { configId: 'model', sessionId, value },
    );
    return this.resolveCurrentModel(setResult.configOptions) ?? value;
  }

  private normalizeModelId(value: string): string {
    return value.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
  }

  private parsePermissionRequest(value: unknown): DevinAcpPermissionRequest {
    if (!isRecord(value) || !Array.isArray(value.options) || !isRecord(value.toolCall)) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission request');
    }

    const options = value.options.flatMap((option) =>
      isRecord(option) && typeof option.name === 'string' && typeof option.optionId === 'string'
        ? [{ name: option.name, optionId: option.optionId }]
        : [],
    );
    if (
      options.length !== value.options.length ||
      options.length === 0 ||
      typeof value.toolCall.toolCallId !== 'string'
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission options');
    }

    const meta = isRecord(value.toolCall._meta) ? value.toolCall._meta : undefined;
    const editableCommand = meta?.['cognition.ai/editableCommand'];
    const title =
      typeof value.toolCall.title === 'string' && value.toolCall.title
        ? value.toolCall.title
        : typeof editableCommand === 'string' && editableCommand
          ? editableCommand
          : 'Allow Devin to continue?';
    return {
      options,
      toolCall: { title, toolCallId: value.toolCall.toolCallId },
    };
  }

  private async selectPermissionOption(
    message: AcpRpcMessage,
    request: DevinAcpPermissionRequest,
  ): Promise<DevinAcpPermissionOption | undefined> {
    if (!this.options.askUserBridge) return;

    const toolCallId = `devin-permission-${String(message.id)}-${request.toolCall.toolCallId}`;
    const arguments_ = {
      questions: [
        {
          header: 'Permission required',
          multiSelect: false,
          options: request.options.map(({ name, optionId }) => ({ id: optionId, label: name })),
          question: request.toolCall.title,
        },
      ],
    } satisfies CanonicalAskQuestionArgs;
    await this.pushToPipeline({
      identifier: 'claude-code',
      rawInput: arguments_,
      sessionUpdate: 'tool_call',
      title: 'askUserQuestion',
      toolCallId,
    });
    const answer = await this.options.askUserBridge.pending({
      arguments: arguments_,
      interactionKind: 'permission',
      toolCallId,
    });
    await this.pushToPipeline({
      rawOutput: answer,
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId,
    });

    const selections = this.getAnswerSelections(answer, request.toolCall.title);
    return request.options.find(({ optionId }) => selections.includes(optionId));
  }

  private getAnswerSelections(answer: InterventionAnswer, question: string): string[] {
    if (answer.cancelled || !isRecord(answer.result)) return [];
    const selection = answer.result[question];
    return (Array.isArray(selection) ? selection : [selection]).flatMap((value) =>
      typeof value === 'string' ? [value] : [],
    );
  }
}
