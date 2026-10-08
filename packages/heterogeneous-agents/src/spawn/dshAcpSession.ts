import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import { isRecord } from '@lobechat/utils/object';

import type { AcpAgentSessionOptions } from './acpAgentSession';
import {
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  selectAcpPermissionOption,
} from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpServerRequestError } from './acpStdioClient';
import type { CliCommandStatus } from './resolveCliCommand';
import { detectValidatedCommand } from './resolveCliCommand';

/**
 * DeepSeek Harness over the Agent Client Protocol.
 *
 * The runtime is the user-installed DeepSeek Harness CLI (`@deepseek-ai/dsh`)
 * serving its shipped `acp` profile on stdio. That profile — unlike the `sdk`
 * profile — implements `session/resume`, so a conversation continues the same
 * persisted harness session across processes, which is how LobeHub runs every
 * turn. Nothing from `@deepseek-ai/*` ships with LobeHub.
 */

/** The official DeepSeek Harness CLI executable (`npm i -g @deepseek-ai/dsh`). */
export const DSH_COMMAND = 'dsh';

/** `dsh --version` prints a bare semantic version (e.g. `0.2.0-rc.2`). */
export const DSH_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/;

/** First release whose CLI ships the `acp` profile with `session/resume`. */
export const DSH_MIN_VERSION = '0.2.0';

/** Compare release numbers only, so `0.2.0-rc.2` already counts as 0.2. */
const isSupportedDshVersion = (version: string | undefined): boolean => {
  const parts = version
    ?.match(/(\d+)\.(\d+)\.(\d+)/)
    ?.slice(1)
    .map(Number);
  if (!parts) return false;
  const minimum = DSH_MIN_VERSION.split('.').map(Number);
  for (const [index, part] of parts.entries()) {
    if (part !== minimum[index]) return part > minimum[index];
  }
  return true;
};

/**
 * Find a `dsh` that can run LobeHub turns. An older CLI still answers
 * `--version` but has no `acp` profile, so it is reported unavailable here
 * rather than failing every turn after the agent was created.
 */
export const detectDshCommand = async (
  command: string = DSH_COMMAND,
  env?: NodeJS.ProcessEnv,
): Promise<CliCommandStatus> => {
  const status = await detectValidatedCommand(
    command,
    { validatePattern: DSH_VERSION_PATTERN },
    env,
  );
  if (!status.available || isSupportedDshVersion(status.version)) return status;
  return {
    ...status,
    available: false,
    error: `DeepSeek Harness CLI ${status.version} is too old; LobeHub needs ${DSH_MIN_VERSION} or newer. Update it with: npm i -g @deepseek-ai/dsh`,
  };
};

/** Select the CLI's shipped ACP profile, served on stdio until disconnect. */
export const DSH_ACP_PROFILE_ARGS: readonly string[] = ['--profile', 'acp'];

/** The profile boots its plugin tree before answering `initialize`. */
const DSH_REQUEST_TIMEOUT_MS = 60_000;

/** How long `dispose` waits for a cancelled turn to wind down before killing it. */
const DISPOSE_GRACE_MS = 5000;

const DSH_MODEL_CONFIG_ID = 'model';

interface DshInitializeResult {
  agentCapabilities?: { sessionCapabilities?: { resume?: unknown } };
  protocolVersion?: number | string;
}

interface DshConfigOption {
  currentValue?: unknown;
  id?: unknown;
  options?: unknown;
}

interface DshSessionResult {
  configOptions?: DshConfigOption[];
  sessionId?: string;
}

export interface DshAcpSessionOptions extends AcpAgentSessionOptions {
  /**
   * Model to select, by name (`deepseek-v4-pro`). A name the runtime does not
   * offer keeps the harness's own default rather than failing the turn.
   */
  model?: string;
  prompt: string;
}

/**
 * The harness encodes each model choice as a JSON `[provider, model]` pair;
 * `config` options group them by provider.
 */
const modelChoices = (configOptions: DshConfigOption[] | undefined) => {
  const option = configOptions?.find(({ id }) => id === DSH_MODEL_CONFIG_ID);
  const flatten = (entries: unknown): { name?: string; value: string }[] =>
    Array.isArray(entries)
      ? entries.flatMap((entry) => {
          if (!isRecord(entry)) return [];
          if (Array.isArray(entry.options)) return flatten(entry.options);
          return typeof entry.value === 'string'
            ? [
                {
                  name: typeof entry.name === 'string' ? entry.name : undefined,
                  value: entry.value,
                },
              ]
            : [];
        })
      : [];
  return {
    choices: flatten(option?.options),
    current: typeof option?.currentValue === 'string' ? option.currentValue : undefined,
  };
};

/** The model name inside a `[provider, model]` choice value. */
const modelOf = (value: string | undefined): string | undefined => {
  if (!value) return;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && typeof parsed[1] === 'string') return parsed[1];
  } catch {
    // Not the encoded pair; treat the raw value as the model name.
  }
  return value;
};

/** DeepSeek Harness's ACP lifecycle on the shared session base. */
export class DshAcpSession extends AcpAgentSession<DshInitializeResult, DshAcpSessionOptions> {
  constructor(options: DshAcpSessionOptions) {
    super(
      { ...options, requestTimeoutMs: options.requestTimeoutMs ?? DSH_REQUEST_TIMEOUT_MS },
      {
        args: [...DSH_ACP_PROFILE_ARGS, ...options.args],
        pipeline: { agentType: 'deepseek-harness', cwd: options.cwd },
        processLabel: 'DeepSeek Harness ACP',
        transport: 'acp-stdio',
      },
    );
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  protected buildInitializeParams(): unknown {
    return {
      clientCapabilities: { fs: {}, terminal: false },
      clientInfo: { name: 'lobehub', version: this.options.clientVersion },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: DshInitializeResult): void {
    if (
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `Unsupported DeepSeek Harness ACP protocol version: ${String(initialized.protocolVersion)}`,
      );
    }
    if (
      this.options.resumeSessionId &&
      !initialized.agentCapabilities?.sessionCapabilities?.resume
    ) {
      throw new Error(
        'This DeepSeek Harness CLI cannot resume sessions. Update it with: npm i -g @deepseek-ai/dsh',
      );
    }
  }

  protected async establishSession(_initialized: DshInitializeResult): Promise<string> {
    const params = { cwd: this.options.cwd, mcpServers: [] };
    const resumeSessionId = this.options.resumeSessionId;
    const result = resumeSessionId
      ? await this.client.request<DshSessionResult>('session/resume', {
          ...params,
          sessionId: resumeSessionId,
        })
      : await this.client.request<DshSessionResult>('session/new', params);

    const sessionId = resumeSessionId ?? result?.sessionId;
    if (!sessionId) throw new Error('DeepSeek Harness ACP returned no session id');
    this.acpSessionId = sessionId;

    const model = await this.selectModel(sessionId, result?.configOptions);
    await this.pushToPipeline({ model, sessionId, type: 'dsh_session' });
    this.options.onSessionId(sessionId);
    return sessionId;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return { prompt: [{ text: this.options.prompt, type: 'text' }], sessionId };
  }

  protected override async settlePrompt(result: unknown): Promise<void> {
    await this.client.drain();
    await this.pushToPipeline({
      stopReason: isRecord(result) ? result.stopReason : undefined,
      type: 'dsh_prompt_completed',
    });
  }

  protected async onRunFailure(error: Error): Promise<void> {
    await this.pushToPipeline({ message: error.message, type: 'dsh_error' });
    await this.emitEvents(await this.pipeline.flush());
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (message.method !== 'session/update') return;
    const update = (message.params as { update?: unknown } | undefined)?.update;
    if (isRecord(update)) await this.pushToPipeline(update);
  }

  /**
   * LobeHub runs agents headless. The harness's default `workspace-write`
   * preset does not ask for workspace edits; anything it still escalates is
   * allowed once, the same unattended policy the other ACP agents use.
   */
  protected handleServerRequest(message: AcpRpcMessage): unknown {
    if (message.method === 'session/request_permission') {
      const optionId = selectAcpPermissionOption(message.params, [
        ({ kind }) => kind === 'allow_once',
        ({ kind }) => kind === 'allow_always',
      ]);
      return { outcome: optionId ? { optionId, outcome: 'selected' } : { outcome: 'cancelled' } };
    }
    throw new AcpServerRequestError(-32_601, `Unsupported ACP client request: ${message.method}`);
  }

  /** Switch to the requested model when the runtime offers it; report the model in effect. */
  private async selectModel(
    sessionId: string,
    configOptions: DshConfigOption[] | undefined,
  ): Promise<string | undefined> {
    const { choices, current } = modelChoices(configOptions);
    const wanted = this.options.model?.trim();
    const choice = wanted
      ? choices.find(({ name, value }) => name === wanted || modelOf(value) === wanted)
      : undefined;
    if (!choice || choice.value === current) return modelOf(current);

    await this.client.request('session/set_config_option', {
      configId: DSH_MODEL_CONFIG_ID,
      sessionId,
      value: choice.value,
    });
    return modelOf(choice.value);
  }
}

export interface SpawnDshAcpSessionOptions {
  /** Extra runtime arguments, appended after the `acp` profile selection. */
  args?: string[];
  clientVersion?: string;
  /** The `dsh` executable (name on PATH or absolute path). Defaults to {@link DSH_COMMAND}. */
  command?: string;
  /** Agent workspace; also the harness session `cwd` a resume must match. */
  cwd: string;
  env?: Record<string, string>;
  model?: string;
  /** Called as soon as the turn's harness session is established. */
  onSessionId?: (sessionId: string) => void;
  operationId?: string;
  /** Harness session to continue. Omit to open a new one. */
  resumeSessionId?: string;
}

export interface DshAcpSessionHandle {
  /** Stop the runtime: cancel any running turn, then kill it after a grace period. */
  dispose: () => Promise<void>;
  /** Run one turn and stream its events. A handle runs a single turn. */
  prompt: (text: string) => AsyncGenerator<AgentStreamEvent>;
  /** The harness session this turn ran on, once it is established. */
  readonly sessionId: string | undefined;
}

/**
 * Prepare one DeepSeek Harness turn. The runtime starts when `prompt` is
 * iterated, so a caller can still back out (e.g. a Stop before launch) without
 * having spawned anything.
 */
export const spawnDshAcpSession = (options: SpawnDshAcpSessionOptions): DshAcpSessionHandle => {
  let session: DshAcpSession | undefined;
  let running: Promise<void> | undefined;
  let disposed = false;

  const dispose = async () => {
    disposed = true;
    if (!session || !running) return;
    session.interrupt();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, DISPOSE_GRACE_MS);
    });
    await Promise.race([running.catch(() => {}), grace]);
    clearTimeout(timer);
    session.close('SIGKILL');
  };

  async function* prompt(text: string): AsyncGenerator<AgentStreamEvent> {
    if (session) throw new Error('A DeepSeek Harness handle runs a single turn');
    if (disposed) return;

    const queue: AgentStreamEvent[] = [];
    let wake: (() => void) | undefined;
    const notify = () => {
      wake?.();
      wake = undefined;
    };

    session = new DshAcpSession({
      args: options.args ?? [],
      clientVersion: options.clientVersion ?? '0.0.0',
      commandPath: options.command ?? DSH_COMMAND,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      model: options.model,
      onEvents: (events) => {
        queue.push(...events);
        notify();
      },
      onRawMessage: () => {},
      onRuntimeStatus: () => {},
      onSessionId: (sessionId) => options.onSessionId?.(sessionId),
      onStderr: () => {},
      operationId: options.operationId ?? '',
      prompt: text,
      resumeSessionId: options.resumeSessionId,
      sessionId: options.resumeSessionId ?? '',
    });

    let settled = false;
    let failure: unknown;
    running = session.run().then(
      () => {
        settled = true;
        notify();
      },
      (error) => {
        settled = true;
        failure = error;
        notify();
      },
    );

    while (true) {
      while (queue.length > 0) yield queue.shift()!;
      if (settled) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
    if (failure && !disposed) throw failure;
  }

  return {
    dispose,
    prompt,
    get sessionId() {
      return session?.sessionId;
    },
  };
};
