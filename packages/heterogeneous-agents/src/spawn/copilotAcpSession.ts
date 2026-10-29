import { isRecord } from '@lobechat/utils/object';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import {
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  selectAcpPermissionOption,
} from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpRpcResponseError, AcpServerRequestError } from './acpStdioClient';
import type { AgentPromptInput, BuildAgentInputOptions } from './input';
import { normalizeImage } from './input';

/**
 * GitHub Copilot CLI over the Agent Client Protocol (`copilot --acp`).
 *
 * Copilot executes every tool in its own process and asks before running a
 * shell command (`session/request_permission`), so the client advertises no
 * `fs` / `terminal` capability and routes permission requests to LobeHub's
 * intervention UI. ACP exposes no model catalog: a requested model is switched
 * with `session/set_model`, which Copilot accepts without validating the id.
 */

const TRANSPORT = 'copilot-acp' as const;
const ALLOW_ALL_CONFIG_ID = 'allow_all';

/**
 * Flags that would take over the host-owned ACP lifecycle (prompt, resume,
 * output framing) or silently approve every tool behind LobeHub's permission
 * prompts — the `allow_all` config option still reads `off` under them.
 */
const COPILOT_ACP_RESERVED_ARGS = new Set([
  '--acp',
  '--allow-all',
  '--allow-all-paths',
  '--allow-all-tools',
  '--allow-all-urls',
  '--attachment',
  '--autopilot',
  '--connect',
  '--continue',
  '--help',
  '--interactive',
  '--mode',
  '--output-format',
  '--prompt',
  '--resume',
  '--session-id',
  '--share',
  '--share-gist',
  '--silent',
  '--stream',
  '--version',
  '--yolo',
  '-h',
  '-i',
  '-p',
  '-r',
  '-s',
  '-v',
]);

export interface CopilotAcpTextPromptBlock {
  text: string;
  type: 'text';
}

export interface CopilotAcpImagePromptBlock {
  data: string;
  mimeType: string;
  type: 'image';
}

export type CopilotAcpPromptBlock = CopilotAcpImagePromptBlock | CopilotAcpTextPromptBlock;

export const buildCopilotAcpArgs = (extraArgs: string[] = []): string[] => {
  for (const argument of extraArgs) {
    const flag = argument.split('=', 1)[0]!;
    if (COPILOT_ACP_RESERVED_ARGS.has(flag)) {
      throw new Error(`GitHub Copilot ACP does not support CLI argument: ${argument}`);
    }
  }
  return ['--acp', ...extraArgs];
};

export const buildCopilotAcpPrompt = async (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<CopilotAcpPromptBlock[]> => {
  const blocks = typeof prompt === 'string' ? [{ text: prompt, type: 'text' as const }] : prompt;
  const result: CopilotAcpPromptBlock[] = [];
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

interface CopilotAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
  };
  protocolVersion?: number | string;
}

interface CopilotAcpSessionResult {
  configOptions?: unknown;
  models?: unknown;
  sessionId?: string;
}

interface CopilotAcpPromptResult {
  stopReason?: string;
  usage?: unknown;
}

interface CopilotAcpPermissionOption {
  kind: string;
  name: string;
  optionId: string;
}

interface CopilotAcpPermissionRequest {
  options: CopilotAcpPermissionOption[];
  toolCall: { title: string; toolCallId: string };
}

/** Where a session advertises its selectable models, if anywhere. */
type CopilotAcpModelSelector =
  | { configId: string; currentModelId?: string; kind: 'config'; values: string[] }
  | { currentModelId?: string; kind: 'models'; values: string[] };

const selectConfigOptions = (configOptions: unknown): Record<string, unknown>[] =>
  Array.isArray(configOptions)
    ? configOptions.filter((option): option is Record<string, unknown> => isRecord(option))
    : [];

/**
 * Read a model selector from either a `model` select config option or the
 * ACP `models` session state. Copilot 1.0.105 exposes neither, but either is
 * preferred over the unvalidated `session/set_model` once it appears.
 */
export const parseCopilotAcpModelSelector = (
  result: Pick<CopilotAcpSessionResult, 'configOptions' | 'models'> | null | undefined,
): CopilotAcpModelSelector | undefined => {
  const config = selectConfigOptions(result?.configOptions).find(
    (option) => option.type === 'select' && (option.category === 'model' || option.id === 'model'),
  );
  if (config && typeof config.id === 'string' && Array.isArray(config.options)) {
    return {
      configId: config.id,
      currentModelId: typeof config.currentValue === 'string' ? config.currentValue : undefined,
      kind: 'config',
      values: config.options.flatMap((option) =>
        isRecord(option) && typeof option.value === 'string' ? [option.value] : [],
      ),
    };
  }

  const models = isRecord(result?.models) ? result.models : undefined;
  if (models && Array.isArray(models.availableModels)) {
    return {
      currentModelId: typeof models.currentModelId === 'string' ? models.currentModelId : undefined,
      kind: 'models',
      values: models.availableModels.flatMap((model) =>
        isRecord(model) && typeof model.modelId === 'string' ? [model.modelId] : [],
      ),
    };
  }
};

/** `session/load` of an unknown id fails with ACP's resource-not-found error. */
export const isCopilotAcpSessionNotFoundError = (error: unknown): error is AcpRpcResponseError =>
  error instanceof AcpRpcResponseError &&
  error.method === 'session/load' &&
  error.rpcError.code === -32_002 &&
  typeof error.rpcError.message === 'string' &&
  /Session .+ not found$/.test(error.rpcError.message);

export interface CopilotAcpSessionOptions extends AcpAgentSessionOptions {
  /**
   * Approve every tool request without asking, through the session's
   * `allow_all` config option. For unattended runs that have no user to ask;
   * interactive runs leave it off so requests reach `askUserBridge`.
   */
  allowAll?: boolean;
  askUserBridge?: AskUserBridge;
  /** Model to switch to after session setup; omit or `default` to keep Copilot's own choice. */
  initialModel?: string;
  inputOptions?: BuildAgentInputOptions;
  onModel?: (model: string) => void;
  prompt: AgentPromptInput | CopilotAcpPromptBlock[];
}

/** GitHub Copilot CLI's ACP v1 lifecycle on the shared session base. */
export class CopilotAcpSession extends AcpAgentSession<
  CopilotAcpInitializeResult,
  CopilotAcpSessionOptions
> {
  private acceptUpdates = false;
  private readonly pendingPermissionIds = new Set<string>();
  private resolvedPrompt: CopilotAcpPromptBlock[] = [];

  constructor(options: CopilotAcpSessionOptions) {
    super(options, {
      args: buildCopilotAcpArgs(options.args),
      pipeline: { agentType: 'copilot', cwd: options.cwd },
      processLabel: 'GitHub Copilot ACP',
      transport: TRANSPORT,
    });
  }

  get nativeSessionId(): string | undefined {
    return this.acpSessionId;
  }

  /**
   * A cancelled turn must also settle a permission request Copilot is still
   * blocked on; the cancelled answer then closes its askUserQuestion card.
   */
  override interrupt(): void {
    for (const toolCallId of this.pendingPermissionIds) {
      this.options.askUserBridge?.cancel(toolCallId, 'user_cancelled');
    }
    super.interrupt();
  }

  protected async prepareRun(): Promise<void> {
    const prompt = this.options.prompt;
    this.resolvedPrompt =
      Array.isArray(prompt) &&
      prompt.every((block) => block.type === 'text' || (block.type === 'image' && 'data' in block))
        ? (prompt as CopilotAcpPromptBlock[])
        : await buildCopilotAcpPrompt(prompt as AgentPromptInput, this.options.inputOptions);
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'lobehub', title: 'LobeHub', version: this.options.clientVersion },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: CopilotAcpInitializeResult): void {
    if (
      initialized?.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized?.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `GitHub Copilot ACP returned unsupported protocol version: ${String(initialized?.protocolVersion)}`,
      );
    }
  }

  protected async establishSession(initialized: CopilotAcpInitializeResult): Promise<string> {
    if (
      this.resolvedPrompt.some((block) => block.type === 'image') &&
      initialized.agentCapabilities?.promptCapabilities?.image !== true
    ) {
      throw new Error('GitHub Copilot ACP does not support image prompt blocks');
    }
    const resumeSessionId = this.options.resumeSessionId;
    if (resumeSessionId && initialized.agentCapabilities?.loadSession !== true) {
      throw new Error('GitHub Copilot ACP does not support loading sessions');
    }

    // `session/load` replays the whole history before it resolves; updates
    // stay gated until the new prompt starts so the replay is not re-rendered.
    const result = await this.client.request<CopilotAcpSessionResult>(
      resumeSessionId ? 'session/load' : 'session/new',
      {
        cwd: this.options.cwd,
        mcpServers: [],
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      },
    );
    const sessionId = result?.sessionId ?? resumeSessionId;
    if (!sessionId) throw new Error('GitHub Copilot ACP returned no session id');
    this.acpSessionId = sessionId;
    this.options.onSessionId(sessionId);

    if (this.options.allowAll) await this.enableAllowAll(sessionId, result);
    const model = await this.applyInitialModel(sessionId, result);
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
    await this.client.drain();
    const { stopReason, usage } = (result ?? {}) as CopilotAcpPromptResult;
    await this.pushToPipeline({ stopReason, type: 'copilot_prompt_completed', usage });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    this.options.askUserBridge?.cancelAll('session_ended');
    await this.pushToPipeline({ message: error.message, type: 'copilot_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async onRunCancelled(): Promise<void> {
    this.options.askUserBridge?.cancelAll('session_ended');
    await this.pushToPipeline({ stopReason: 'cancelled', type: 'copilot_prompt_completed' });
  }

  protected onHostClose(): void {
    this.options.askUserBridge?.cancelAll('session_ended');
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update' || !this.acceptUpdates) return;
    const update = (message.params as { update?: unknown } | undefined)?.update;
    if (isRecord(update)) await this.pushToPipeline(update);
  }

  protected async handleServerRequest(message: AcpRpcMessage): Promise<unknown> {
    if (message.method !== 'session/request_permission') {
      throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
    }
    const request = this.parsePermissionRequest(message.params);

    // `allow_all` normally keeps these from arriving; approve any stragglers.
    const optionId = this.options.allowAll
      ? selectAcpPermissionOption(message.params, [
          ({ kind }) => kind === 'allow_once',
          ({ kind }) => kind === 'allow_always',
        ])
      : this.options.askUserBridge
        ? await this.askPermission(message, request)
        : // Nobody can answer: deny explicitly. Copilot then fails just this
          // tool and ends the turn instead of waiting on the request.
          selectAcpPermissionOption(message.params, [
            ({ kind }) => kind === 'reject_once',
            ({ kind }) => kind === 'reject_always',
          ]);
    return { outcome: optionId ? { optionId, outcome: 'selected' } : { outcome: 'cancelled' } };
  }

  private async enableAllowAll(sessionId: string, result: CopilotAcpSessionResult): Promise<void> {
    const option = selectConfigOptions(result?.configOptions).find(
      ({ id }) => id === ALLOW_ALL_CONFIG_ID,
    );
    if (!option || option.currentValue === 'on') return;
    await this.client.request('session/set_config_option', {
      configId: ALLOW_ALL_CONFIG_ID,
      sessionId,
      value: 'on',
    });
  }

  /**
   * Switch to the requested model and report the one in effect. A session
   * that advertises its models must offer the requested id; otherwise the
   * id goes straight to `session/set_model`.
   */
  private async applyInitialModel(
    sessionId: string,
    result: CopilotAcpSessionResult,
  ): Promise<string | undefined> {
    const selector = parseCopilotAcpModelSelector(result);
    const requested = this.options.initialModel?.trim();
    if (!requested || requested === 'default') return selector?.currentModelId;
    if (requested === selector?.currentModelId) return requested;
    if (selector && !selector.values.includes(requested)) {
      throw new Error(`GitHub Copilot ACP model is unavailable: ${requested}`);
    }

    if (selector?.kind === 'config') {
      await this.client.request('session/set_config_option', {
        configId: selector.configId,
        sessionId,
        value: requested,
      });
    } else {
      await this.client.request('session/set_model', { modelId: requested, sessionId });
    }
    return requested;
  }

  private parsePermissionRequest(value: unknown): CopilotAcpPermissionRequest {
    if (!isRecord(value) || !Array.isArray(value.options) || !isRecord(value.toolCall)) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission request');
    }
    const options = value.options.flatMap((option) =>
      isRecord(option) &&
      typeof option.kind === 'string' &&
      typeof option.name === 'string' &&
      typeof option.optionId === 'string' &&
      option.optionId
        ? [{ kind: option.kind, name: option.name, optionId: option.optionId }]
        : [],
    );
    if (
      options.length === 0 ||
      options.length !== value.options.length ||
      new Set(options.map(({ optionId }) => optionId)).size !== options.length ||
      typeof value.toolCall.toolCallId !== 'string' ||
      !value.toolCall.toolCallId
    ) {
      throw new AcpServerRequestError(-32_602, 'Invalid session/request_permission options');
    }

    // Shell titles only describe the command ("Run requested shell command"),
    // so show the command itself alongside.
    const rawInput = isRecord(value.toolCall.rawInput) ? value.toolCall.rawInput : undefined;
    const title = [value.toolCall.title, rawInput?.command]
      .flatMap((part) => (typeof part === 'string' && part.trim() ? [part.trim()] : []))
      .join('\n\n')
      .slice(0, 4000);
    return {
      options,
      toolCall: {
        title: title || 'Allow GitHub Copilot to continue?',
        toolCallId: value.toolCall.toolCallId,
      },
    };
  }

  /** Ask through the shared askUserQuestion card; only an exact option id is consent. */
  private async askPermission(
    message: AcpRpcMessage,
    request: CopilotAcpPermissionRequest,
  ): Promise<string | undefined> {
    const bridge = this.options.askUserBridge!;
    const toolCallId = `copilot-permission-${String(message.id)}-${request.toolCall.toolCallId}`;
    const question = request.toolCall.title;
    const arguments_ = {
      questions: [
        {
          header: 'Permission required',
          multiSelect: false,
          options: request.options.map(({ name, optionId }) => ({ id: optionId, label: name })),
          question,
        },
      ],
    };
    await this.pushToPipeline({
      identifier: 'claude-code',
      rawInput: arguments_,
      sessionUpdate: 'tool_call',
      title: 'askUserQuestion',
      toolCallId,
    });

    this.pendingPermissionIds.add(toolCallId);
    let answer: InterventionAnswer;
    try {
      answer = await bridge.pending({
        arguments: arguments_,
        interactionKind: 'permission',
        toolCallId,
      });
    } finally {
      this.pendingPermissionIds.delete(toolCallId);
    }
    await this.pushToPipeline({
      rawOutput: answer,
      sessionUpdate: 'tool_call_update',
      status: 'completed',
      toolCallId,
    });

    if (answer.cancelled || !isRecord(answer.result)) return;
    const selection = answer.result[question];
    const selections = Array.isArray(selection) ? selection : [selection];
    return request.options.find(({ optionId }) => selections.includes(optionId))?.optionId;
  }
}
