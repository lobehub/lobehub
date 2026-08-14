import { pathToFileURL } from 'node:url';

import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { AgentPromptInput } from '../protocol';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpServerRequestError, AcpStdioClient } from './acpStdioClient';
import { AgentStreamPipeline } from './agentStreamPipeline';
import type { HeterogeneousAgentRuntimeStatus } from './claudeAgentSdkSession';
import type { NormalizeImageOptions } from './input';
import { normalizeImage } from './input';

const ACP_PROTOCOL_VERSION = 1;
const ACP_CANCEL_GRACE_MS = 2_000;
const GROK_ACP_TRANSPORT = 'acp-stdio' as const;
const SUPPORTED_AUTH_METHODS = ['cached_token', 'xai.api_key'] as const;

interface AcpTextContentBlock {
  text: string;
  type: 'text';
}

interface AcpImageContentBlock {
  data: string;
  mimeType: string;
  type: 'image';
  uri?: string;
}

export type GrokAcpContentBlock = AcpImageContentBlock | AcpTextContentBlock;

interface AcpInitializeResult {
  _meta?: { defaultAuthMethodId?: string };
  authMethods?: Array<{ id?: string }>;
  protocolVersion?: number | string;
}

interface AcpNewSessionResult {
  sessionId?: string;
}

interface AcpPermissionOption {
  kind?: string;
  optionId?: string;
}

export interface GrokAcpSessionOptions {
  args: string[];
  clientVersion: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onEvents: (events: AgentStreamEvent[]) => Promise<void> | void;
  onRawMessage: (line: string) => Promise<void> | void;
  onRuntimeStatus: (status: HeterogeneousAgentRuntimeStatus) => void;
  onSessionId: (sessionId: string) => void;
  onStderr: (data: string) => Promise<void> | void;
  operationId: string;
  prompt: GrokAcpContentBlock[];
  resumeSessionId?: string;
  sessionId: string;
}

export const buildGrokAcpArgs = (args: string[] = []): string[] => [
  '--no-auto-update',
  'agent',
  '--no-leader',
  '--always-approve',
  ...args,
  'stdio',
];

const promptBlocks = (prompt: AgentPromptInput) =>
  typeof prompt === 'string' ? (prompt ? [{ text: prompt, type: 'text' as const }] : []) : prompt;

/** Convert LobeHub prompt blocks to ACP v1 ContentBlocks without argv or temp-file payloads. */
export const buildGrokAcpPrompt = async (
  prompt: AgentPromptInput,
  options: NormalizeImageOptions = {},
): Promise<GrokAcpContentBlock[]> => {
  const content: GrokAcpContentBlock[] = [];

  for (const block of promptBlocks(prompt)) {
    if (block.type === 'text') {
      if (block.text) content.push({ text: block.text, type: 'text' });
      continue;
    }

    const image = await normalizeImage(block.source, options);
    const uri =
      block.source.type === 'url'
        ? block.source.url
        : block.source.type === 'path'
          ? pathToFileURL(block.source.path).href
          : undefined;
    content.push({
      data: image.buffer.toString('base64'),
      mimeType: image.mediaType,
      type: 'image',
      ...(uri ? { uri } : {}),
    });
  }

  return content;
};

/** Grok Build's ACP v1 lifecycle layered on the reusable stdio transport. */
export class GrokAcpSession {
  private readonly client: AcpStdioClient;
  private readonly pipeline: AgentStreamPipeline;
  private acpSessionId?: string;
  private cancelTimer?: ReturnType<typeof setTimeout>;
  private closedByHost = false;
  private lastStatus?: HeterogeneousAgentRuntimeStatus['state'];

  constructor(private readonly options: GrokAcpSessionOptions) {
    this.pipeline = new AgentStreamPipeline({
      agentType: 'grok-build',
      cwd: options.cwd,
      operationId: options.operationId,
    });
    this.client = new AcpStdioClient({
      args: buildGrokAcpArgs(options.args),
      commandPath: options.commandPath,
      cwd: options.cwd,
      env: options.env,
      onMessage: (message) => this.handleRpcMessage(message),
      onRawMessage: options.onRawMessage,
      onServerRequest: (message) => this.handleServerRequest(message),
      onStderr: options.onStderr,
      processLabel: 'Grok Build ACP',
    });
  }

  get pid(): number | undefined {
    return this.client.pid;
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  async run(): Promise<void> {
    this.emitStatus('starting');

    try {
      await this.client.start();
      const initialized = await this.client.request<AcpInitializeResult>('initialize', {
        _meta: {
          clientType: 'lobehub',
          clientVersion: this.options.clientVersion,
        },
        clientCapabilities: { fs: {}, terminal: false },
        protocolVersion: ACP_PROTOCOL_VERSION,
      });
      if (
        initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
        initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
      ) {
        throw new Error(
          `Unsupported Grok Build ACP protocol version: ${String(initialized.protocolVersion)}`,
        );
      }

      const authMethod = this.resolveAuthMethod(initialized);
      if (authMethod) {
        await this.client.request('authenticate', {
          _meta: { headless: true },
          methodId: authMethod,
        });
      } else if (initialized.authMethods?.length) {
        throw new Error('Authentication required. Run `grok login`, then retry.');
      }

      let acpSessionId: string;
      if (this.options.resumeSessionId) {
        await this.client.request('session/load', {
          _meta: { noReplay: true },
          cwd: this.options.cwd,
          mcpServers: [],
          sessionId: this.options.resumeSessionId,
        });
        acpSessionId = this.options.resumeSessionId;
      } else {
        const session = await this.client.request<AcpNewSessionResult>('session/new', {
          _meta: { yoloMode: true },
          cwd: this.options.cwd,
          mcpServers: [],
        });
        if (!session.sessionId) throw new Error('Grok Build ACP returned no session id');
        acpSessionId = session.sessionId;
      }

      this.acpSessionId = acpSessionId;
      this.options.onSessionId(acpSessionId);
      this.emitStatus('running');

      await this.client.request(
        'session/prompt',
        {
          _meta: { promptId: this.options.operationId },
          prompt: this.options.prompt,
          sessionId: acpSessionId,
        },
        false,
      );
      await this.client.drain();
      if (this.closedByHost) return;
      await this.emitEvents(await this.pipeline.flush());
      if (this.closedByHost) return;
      this.emitStatus('idle');
    } catch (error) {
      if (this.closedByHost) return;

      this.emitStatus('error');
      throw error;
    } finally {
      if (this.cancelTimer) clearTimeout(this.cancelTimer);
      this.client.close();
      if (!this.closedByHost) this.emitStatus('closed');
    }
  }

  interrupt(): void {
    if (!this.acpSessionId) {
      this.close();
      return;
    }

    this.client.notify('session/cancel', {
      _meta: { cancelTrigger: 'ctrl_c' },
      sessionId: this.acpSessionId,
    });
    this.cancelTimer ??= setTimeout(() => this.close(), ACP_CANCEL_GRACE_MS);
    this.cancelTimer.unref?.();
  }

  close(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.closedByHost) return;
    this.closedByHost = true;
    this.client.close(signal);
    this.emitStatus('closed');
  }

  private async handleRpcMessage(message: AcpRpcMessage): Promise<void> {
    if (this.closedByHost || this.isReplayMessage(message)) return;
    const events = await this.pipeline.push(`${JSON.stringify(message)}\n`);
    if (this.closedByHost) return;
    await this.emitEvents(events);
  }

  private handleServerRequest(message: AcpRpcMessage): unknown {
    switch (message.method) {
      case 'session/request_permission': {
        const params = this.asRecord(message.params);
        const permissionOptions = Array.isArray(params?.options)
          ? params.options.flatMap((option) => {
              const value = this.asRecord(option);
              return value ? [value as AcpPermissionOption] : [];
            })
          : [];
        const selected =
          permissionOptions.find(({ kind }) => kind === 'allow_always') ??
          permissionOptions.find(({ kind }) => kind === 'allow_once');
        return {
          outcome:
            typeof selected?.optionId === 'string'
              ? { optionId: selected.optionId, outcome: 'selected' }
              : { outcome: 'cancelled' },
        };
      }
      case 'x.ai/ask_user_question': {
        // P1 is deliberately non-interactive. Match Grok's own headless
        // client policy so this reverse request cannot block the turn.
        return { outcome: 'cancelled' };
      }
      case 'x.ai/exit_plan_mode': {
        return { outcome: 'approved' };
      }
      default: {
        throw new AcpServerRequestError(
          -32_601,
          `Unsupported ACP client request: ${message.method}`,
        );
      }
    }
  }

  private resolveAuthMethod(result: AcpInitializeResult): string | undefined {
    const ids = new Set(
      (result.authMethods ?? []).flatMap(({ id }) => (typeof id === 'string' ? [id] : [])),
    );
    const preferred = result._meta?.defaultAuthMethodId;
    if (
      preferred &&
      ids.has(preferred) &&
      SUPPORTED_AUTH_METHODS.includes(preferred as (typeof SUPPORTED_AUTH_METHODS)[number])
    ) {
      return preferred;
    }
    return SUPPORTED_AUTH_METHODS.find((methodId) => ids.has(methodId));
  }

  private isReplayMessage(message: AcpRpcMessage): boolean {
    const params = this.asRecord(message.params);
    const paramsMeta = this.asRecord(params?._meta);
    const update = this.asRecord(params?.update);
    const updateMeta = this.asRecord(update?._meta);
    return paramsMeta?.isReplay === true || updateMeta?.isReplay === true;
  }

  private async emitEvents(events: AgentStreamEvent[]): Promise<void> {
    if (!this.closedByHost && events.length > 0) await this.options.onEvents(events);
  }

  private emitStatus(state: HeterogeneousAgentRuntimeStatus['state']): void {
    if (this.lastStatus === 'closed' || state === this.lastStatus) return;
    this.lastStatus = state;
    this.options.onRuntimeStatus({
      activeTasks: [],
      lastEventAt: Date.now(),
      operationId: this.options.operationId,
      sessionId: this.options.sessionId,
      state,
      transport: GROK_ACP_TRANSPORT,
    });
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }
}
