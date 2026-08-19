import { isRecord } from '@lobechat/utils/object';

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

const NOTIFICATION_DRAIN_QUIET_MS = 250;
const NOTIFICATION_DRAIN_TIMEOUT_MS = 2000;
const TRANSPORT = 'minimax-code-acp' as const;
const AUTH_REQUIRED_MESSAGE = 'MiniMax Code could not authenticate. Run `mcode login`, then retry.';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface MinimaxCodeAcpTextPromptBlock {
  text: string;
  type: 'text';
}

export interface MinimaxCodeAcpImagePromptBlock {
  data: string;
  mimeType: string;
  type: 'image';
}

export type MinimaxCodeAcpPromptBlock =
  MinimaxCodeAcpImagePromptBlock | MinimaxCodeAcpTextPromptBlock;

export const buildMinimaxCodeAcpArgs = (extraArgs: string[] = []): string[] => [
  'acp',
  ...extraArgs,
];

export const buildMinimaxCodeAcpPrompt = async (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<MinimaxCodeAcpPromptBlock[]> => {
  const blocks = typeof prompt === 'string' ? [{ text: prompt, type: 'text' as const }] : prompt;
  const result: MinimaxCodeAcpPromptBlock[] = [];
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

interface MinimaxCodeAcpInitializeResult {
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean };
    sessionCapabilities?: { close?: unknown; resume?: unknown };
  };
  protocolVersion?: number;
}

interface MinimaxCodeAcpSessionResult {
  sessionId?: string;
}

interface MinimaxCodeAcpPromptResult {
  stopReason?: string;
}

export interface MinimaxCodeAcpSessionOptions extends AcpAgentSessionOptions {
  inputOptions?: BuildAgentInputOptions;
  prompt: AgentPromptInput | MinimaxCodeAcpPromptBlock[];
}

const isAuthRequiredError = (error: unknown): boolean => {
  if (error instanceof AcpRpcResponseError) {
    if (error.rpcError.code === -32_000) return true;
    const detail = [
      error.message,
      error.rpcError.message,
      JSON.stringify(error.rpcError.data ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    return detail.includes('authentication required') || detail.includes('mcode login');
  }
  if (error instanceof Error) {
    return /authentication required|mcode login|sign in to minimax/i.test(error.message);
  }
  return false;
};

const wrapAuthError = (error: unknown): Error => {
  if (isAuthRequiredError(error)) return new Error(AUTH_REQUIRED_MESSAGE, { cause: error });
  return error instanceof Error ? error : new Error(String(error));
};

/** MiniMax Code's ACP v1 lifecycle (resume + login diagnostics) on the shared session base. */
export class MinimaxCodeAcpSession extends AcpAgentSession<
  MinimaxCodeAcpInitializeResult,
  MinimaxCodeAcpSessionOptions
> {
  private acceptUpdates = false;
  private lastSessionUpdateAt = 0;
  private resolvedPrompt: MinimaxCodeAcpPromptBlock[] = [];

  constructor(options: MinimaxCodeAcpSessionOptions) {
    super(options, {
      args: buildMinimaxCodeAcpArgs(options.args),
      pipeline: { agentType: 'minimax-code' },
      processLabel: 'MiniMax Code ACP',
      transport: TRANSPORT,
    });
  }

  get nativeSessionId(): string | undefined {
    return this.acpSessionId;
  }

  override async run(): Promise<void> {
    try {
      await super.run();
    } catch (error) {
      throw wrapAuthError(error);
    }
  }

  protected async prepareRun(): Promise<void> {
    this.resolvedPrompt = await this.resolvePrompt();
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { auth: { terminal: true } },
      clientInfo: {
        name: 'lobehub',
        title: 'LobeHub',
        version: this.options.clientVersion,
      },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: MinimaxCodeAcpInitializeResult): void {
    if (
      typeof initialized?.protocolVersion === 'number' &&
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION
    ) {
      throw new Error(
        `MiniMax Code ACP returned unsupported protocol version: ${initialized.protocolVersion}`,
      );
    }
  }

  protected override async initializeConnection(): Promise<MinimaxCodeAcpInitializeResult> {
    try {
      return await super.initializeConnection();
    } catch (error) {
      throw wrapAuthError(error);
    }
  }

  protected async establishSession(initialized: MinimaxCodeAcpInitializeResult): Promise<string> {
    if (
      this.resolvedPrompt.some((block) => block.type === 'image') &&
      initialized?.agentCapabilities?.promptCapabilities?.image !== true
    ) {
      throw new Error('MiniMax Code ACP agent does not support image prompt blocks');
    }

    try {
      const sessionId = await this.openSession(initialized);
      this.options.onSessionId(sessionId);
      await this.pushToPipeline({ sessionId, type: 'minimax_code_session' });
      return sessionId;
    } catch (error) {
      throw wrapAuthError(error);
    }
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
      stopReason: (result as MinimaxCodeAcpPromptResult | undefined)?.stopReason,
      type: 'minimax_code_prompt_completed',
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    const wrapped = wrapAuthError(error);
    await this.pushToPipeline({ message: wrapped.message, type: 'minimax_code_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update' || !this.acceptUpdates) return;
    this.lastSessionUpdateAt = Date.now();
    const params = isRecord(message.params) ? message.params : undefined;
    if (!isRecord(params?.update)) return;
    await this.pushToPipeline(params.update);
  }

  protected handleServerRequest(message: AcpRpcMessage): unknown {
    if (message.method === 'session/request_permission') {
      const optionId = selectAcpPermissionOption(message.params, [
        (option) =>
          option.kind === 'allow_always' ||
          option.optionId === 'allow_always' ||
          option.optionId === 'allow_session' ||
          option.optionId === 'approve_for_session',
        (option) => option.kind === 'allow_once' || option.optionId === 'allow_once',
      ]);
      if (optionId) return { outcome: { optionId, outcome: 'selected' } };
      throw new AcpServerRequestError(-32_603, 'No safe permission option was offered');
    }
    throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
  }

  private async openSession(initialized: MinimaxCodeAcpInitializeResult): Promise<string> {
    const resumeSessionId = this.options.resumeSessionId;
    if (!resumeSessionId) {
      const sessionResult = await this.client.request<MinimaxCodeAcpSessionResult>('session/new', {
        cwd: this.options.cwd,
        mcpServers: [],
      });
      if (!sessionResult?.sessionId) throw new Error('MiniMax Code ACP returned no session id');
      return sessionResult.sessionId;
    }

    const canResume = initialized?.agentCapabilities?.sessionCapabilities?.resume !== undefined;
    const canLoad = initialized?.agentCapabilities?.loadSession === true;
    if (!canResume && !canLoad) {
      throw new Error('MiniMax Code ACP agent does not support resuming sessions');
    }

    try {
      if (canResume) {
        const sessionResult = await this.client.request<MinimaxCodeAcpSessionResult>(
          'session/resume',
          {
            cwd: this.options.cwd,
            mcpServers: [],
            sessionId: resumeSessionId,
          },
        );
        return sessionResult?.sessionId ?? resumeSessionId;
      }

      const sessionResult = await this.client.request<MinimaxCodeAcpSessionResult>('session/load', {
        cwd: this.options.cwd,
        mcpServers: [],
        sessionId: resumeSessionId,
      });
      return sessionResult?.sessionId ?? resumeSessionId;
    } catch (error) {
      throw new Error(
        `MiniMax Code could not resume session ${resumeSessionId}. ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }

  private async resolvePrompt(): Promise<MinimaxCodeAcpPromptBlock[]> {
    const prompt = this.options.prompt;
    if (
      Array.isArray(prompt) &&
      prompt.every(
        (block) =>
          'type' in block && (block.type === 'text' || ('data' in block && block.type === 'image')),
      )
    ) {
      return prompt as MinimaxCodeAcpPromptBlock[];
    }
    return buildMinimaxCodeAcpPrompt(prompt as AgentPromptInput, this.options.inputOptions);
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
