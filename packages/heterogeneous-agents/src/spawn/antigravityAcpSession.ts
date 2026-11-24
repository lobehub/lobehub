import { isRecord } from '@lobechat/utils/object';

import type { AgentPromptInput } from '../protocol';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import {
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  selectAcpPermissionOption,
} from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpRpcResponseError, AcpServerRequestError } from './acpStdioClient';
import { buildAntigravityAcpLaunch } from './antigravity';
import type { BuildAgentInputOptions } from './input';
import type { TraeAcpPromptBlock } from './traeAcpSession';
import { buildTraeAcpPrompt } from './traeAcpSession';

const TRANSPORT = 'antigravity-acp' as const;

export type AntigravityAcpPromptBlock = TraeAcpPromptBlock;

interface AntigravityAcpInitializeResult {
  agentCapabilities?: {
    promptCapabilities?: { image?: boolean };
    sessionCapabilities?: { resume?: unknown };
  };
  protocolVersion?: number | string;
}

interface AntigravityAcpSessionResult {
  configOptions?: unknown;
  models?: { availableModels?: unknown };
  sessionId?: string;
}

interface AntigravityAcpPromptResult {
  stopReason?: string;
  usage?: unknown;
}

interface SteerDelivery {
  result: Promise<AntigravityAcpPromptResult>;
  uuid: string;
}

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cachedReadTokens', 'thoughtTokens'] as const;

type UsageTotals = Record<(typeof USAGE_FIELDS)[number], number>;

const findConfigOption = (configOptions: unknown, id: string) =>
  Array.isArray(configOptions)
    ? configOptions.find((value) => isRecord(value) && value.id === id)
    : undefined;

const configValue = (configOptions: unknown, id: string): string | undefined => {
  const option = findConfigOption(configOptions, id);
  return isRecord(option) && typeof option.currentValue === 'string'
    ? option.currentValue
    : undefined;
};

/** Values of a select option, flattening grouped options. */
const configOptionValues = (configOptions: unknown, id: string): string[] => {
  const option = findConfigOption(configOptions, id);
  const collect = (entries: unknown): string[] =>
    Array.isArray(entries)
      ? entries.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          if (Array.isArray(entry.options)) return collect(entry.options);
          return typeof entry.value === 'string' ? [entry.value] : [];
        })
      : [];
  return isRecord(option) ? collect(option.options) : [];
};

const availableModelIds = (result: AntigravityAcpSessionResult): Set<string> => {
  const models = result.models?.availableModels;
  return new Set(
    Array.isArray(models)
      ? models.flatMap((model) =>
          isRecord(model) && typeof model.modelId === 'string' ? [model.modelId] : [],
        )
      : [],
  );
};

/**
 * The `model` value agy takes for a selection. The selector groups `agy models`
 * slugs into a model and an effort (`gpt-oss-120b` + `medium`), but a model
 * whose thinking tier is fixed only exists under its full slug
 * (`gpt-oss-120b-medium`).
 */
const resolveModelValue = (
  model: string,
  effort: string | undefined,
  sessionResult: AntigravityAcpSessionResult,
): string => {
  const known = new Set([
    ...configOptionValues(sessionResult.configOptions, 'model'),
    ...availableModelIds(sessionResult),
  ]);
  if (known.size === 0 || known.has(model)) return model;
  if (effort && known.has(`${model}-${effort}`)) return `${model}-${effort}`;
  const variants = [...known].filter((id) => id.startsWith(`${model}-`));
  return variants.length === 1 ? variants[0] : model;
};

export interface AntigravityAcpSessionOptions extends AcpAgentSessionOptions {
  onModel?: (model: string) => void;
  prompt: AntigravityAcpPromptBlock[];
}

export const buildAntigravityAcpPrompt = (
  prompt: AgentPromptInput,
  options: BuildAgentInputOptions = {},
): Promise<AntigravityAcpPromptBlock[]> => buildTraeAcpPrompt(prompt, options);

/** `session/resume` and `session/load` both failed to find the saved conversation. */
export const isAntigravityAcpSessionNotFoundError = (
  error: unknown,
): error is AcpRpcResponseError =>
  error instanceof AcpRpcResponseError &&
  error.method === 'session/load' &&
  /session not found/i.test(error.rpcError.message ?? '');

/**
 * Antigravity over `agy acp`. One run is one user turn; a message the user
 * sends while it runs is steered in with another `session/prompt`: agy ends
 * the pending prompt (`end_turn`) and carries on with the new one inside the
 * same work. The run ends when the latest prompt settles.
 */
export class AntigravityAcpSession extends AcpAgentSession<
  AntigravityAcpInitializeResult,
  AntigravityAcpSessionOptions
> {
  /** Session updates before the prompt (a `session/load` replay) are history, not output. */
  private acceptUpdates = false;
  private readonly launch: ReturnType<typeof buildAntigravityAcpLaunch>;
  /** Steered prompts written to agy, in order, that the run has not settled yet. */
  private readonly steers: SteerDelivery[] = [];
  private steerable = false;
  private usage: UsageTotals = {
    cachedReadTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
  };

  constructor(options: AntigravityAcpSessionOptions) {
    const launch = buildAntigravityAcpLaunch(options.args);
    super(options, {
      args: launch.args,
      pipeline: { agentType: 'antigravity', cwd: options.cwd },
      processLabel: 'Antigravity ACP',
      transport: TRANSPORT,
    });
    this.launch = launch;
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  /**
   * Write a user message into the running turn. `false` when the run takes no
   * input now (not prompting yet, interrupted, or settling): nothing was
   * written, so the message can wait for the next run. agy confirms it read
   * the message when the prompt it interrupts returns, reported as
   * `step_complete { phase: 'user_message', uuid }`.
   */
  steer(prompt: AntigravityAcpPromptBlock[], uuid: string): boolean {
    const sessionId = this.acpSessionId;
    if (!this.steerable || !sessionId || this.closedByHost) return false;

    const result = this.client.request<AntigravityAcpPromptResult>(
      'session/prompt',
      { prompt, sessionId },
      false,
    );
    // Settled in order by `settlePrompt`; a closed transport must not surface
    // as an unhandled rejection before the run gets to it.
    result.catch(() => {});
    this.steers.push({ result, uuid });
    return true;
  }

  override interrupt(): void {
    this.steerable = false;
    super.interrupt();
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'lobehub', title: 'LobeHub', version: this.options.clientVersion },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: AntigravityAcpInitializeResult): void {
    if (
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `Antigravity ACP returned unsupported protocol version: ${String(initialized.protocolVersion)}`,
      );
    }
    if (
      this.options.prompt.some((block) => block.type === 'image') &&
      initialized.agentCapabilities?.promptCapabilities?.image !== true
    ) {
      throw new Error(
        'This Antigravity CLI does not accept images over ACP. Update agy and retry.',
      );
    }
  }

  protected async establishSession(initialized: AntigravityAcpInitializeResult): Promise<string> {
    const sessionResult = await this.openSession(initialized);
    const sessionId = sessionResult.sessionId ?? this.options.resumeSessionId;
    if (!sessionId) throw new Error('Antigravity ACP returned no session id');

    const model = await this.applySessionConfig(sessionId, sessionResult);
    if (model) {
      this.pipeline.configureSession({ model });
      this.options.onModel?.(model);
    }
    this.options.onSessionId(sessionId);
    await this.pushToPipeline({ model, sessionId, type: 'antigravity_session' });
    return sessionId;
  }

  protected onBeforePrompt(): void {
    this.acceptUpdates = true;
    this.steerable = true;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: this.options.prompt, sessionId };
  }

  /**
   * The first prompt settled; settle every message steered in after it, in
   * order. Each one ends the prompt before it, so that is when agy read it.
   */
  protected override async settlePrompt(result: unknown): Promise<void> {
    let last = (isRecord(result) ? result : {}) as AntigravityAcpPromptResult;
    this.addUsage(last.usage);
    for (;;) {
      await this.client.drain();
      const next = this.steers.shift();
      if (!next) break;
      await this.pushToPipeline({ type: 'antigravity_user_message', uuid: next.uuid });
      last = await next.result;
      this.addUsage(last.usage);
    }
    this.steerable = false;

    const used = Object.values(this.usage).some((value) => value > 0);
    await this.pushToPipeline({
      stopReason: last.stopReason,
      type: 'antigravity_prompt_completed',
      ...(used && { usage: { ...this.usage } }),
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    this.steerable = false;
    await this.pushToPipeline({ message: error.message, type: 'antigravity_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async onRunCancelled(): Promise<void> {
    this.steerable = false;
    await this.pushToPipeline({ stopReason: 'cancelled', type: 'antigravity_prompt_completed' });
  }

  protected onHostClose(): void {
    this.steerable = false;
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (!this.acceptUpdates || message.method !== 'session/update') return;
    const params = isRecord(message.params) ? message.params : undefined;
    if (!isRecord(params?.update)) return;
    // Subagent conversations must never leak into the parent's assistant bubble.
    if (typeof params.sessionId === 'string' && params.sessionId !== this.acpSessionId) return;
    await this.pushToPipeline(params.update);
  }

  /**
   * `--dangerously-skip-permissions` makes agy approve tools itself; should it
   * still ask, approve as the print-mode runs did.
   */
  protected handleServerRequest(message: AcpRpcMessage): unknown {
    if (message.method !== 'session/request_permission') {
      throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
    }
    const optionId = selectAcpPermissionOption(message.params, [
      (option) => option.kind === 'allow_always',
      (option) => option.kind === 'allow_once',
    ]);
    return optionId
      ? { outcome: { optionId, outcome: 'selected' } }
      : { outcome: { outcome: 'cancelled' } };
  }

  /**
   * Resume without replaying history; agy points sessions it cannot resume to
   * `session/load`, whose replay arrives before the prompt and is dropped.
   */
  private async openSession(
    initialized: AntigravityAcpInitializeResult,
  ): Promise<AntigravityAcpSessionResult> {
    const params = { cwd: this.options.cwd, mcpServers: [] };
    const resumeSessionId = this.options.resumeSessionId;
    if (!resumeSessionId) {
      return this.client.request<AntigravityAcpSessionResult>('session/new', params);
    }

    const resumeParams = { ...params, sessionId: resumeSessionId };
    if (initialized.agentCapabilities?.sessionCapabilities?.resume !== undefined) {
      try {
        return await this.client.request<AntigravityAcpSessionResult>(
          'session/resume',
          resumeParams,
        );
      } catch (error) {
        if (!(error instanceof AcpRpcResponseError)) throw error;
      }
    }
    const loaded = await this.client.request<AntigravityAcpSessionResult>(
      'session/load',
      resumeParams,
    );
    await this.client.drain();
    return loaded;
  }

  /**
   * Apply the selected model (a full id such as `gemini-4-neon-xhigh`, which
   * agy splits into model and thinking level), effort and mode. Returns the
   * model the session runs.
   */
  private async applySessionConfig(
    sessionId: string,
    sessionResult: AntigravityAcpSessionResult,
  ): Promise<string | undefined> {
    let configOptions = sessionResult.configOptions;
    const set = async (configId: string, value: string) => {
      const result = await this.client.request<{ configOptions?: unknown }>(
        'session/set_config_option',
        { configId, sessionId, value },
      );
      if (result.configOptions !== undefined) configOptions = result.configOptions;
    };

    const { effort, mode } = this.launch;
    const model =
      this.launch.model && this.launch.model !== 'default'
        ? resolveModelValue(this.launch.model, effort, sessionResult)
        : undefined;
    if (model) await set('model', model);
    // Models with a fixed thinking tier (GPT-OSS, Orchestrator) offer no
    // thought_level, and agy rejects setting one.
    if (effort && findConfigOption(configOptions, 'thought_level')) {
      await set('thought_level', effort);
    }
    if (mode) await set('mode', mode);

    const family = configValue(configOptions, 'model');
    if (!family) return model;
    const level = configValue(configOptions, 'thought_level');
    const variant = level ? `${family}-${level}` : undefined;
    return variant && availableModelIds(sessionResult).has(variant) ? variant : family;
  }

  private addUsage(usage: unknown): void {
    if (!isRecord(usage)) return;
    for (const field of USAGE_FIELDS) {
      const value = usage[field];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        this.usage[field] += value;
      }
    }
  }
}
