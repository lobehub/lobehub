import { pathToFileURL } from 'node:url';

import { getAnyCliFlagValue, GROK_BUILD_REASONING_EFFORT_FLAGS } from '@lobechat/types';

import { isAcpReplayMessage } from '../adapters/acpCommon';
import type { AgentPromptInput } from '../protocol';
import type { AcpAgentSessionOptions } from './acpAgentSession';
import {
  ACP_PROTOCOL_VERSION,
  AcpAgentSession,
  selectAcpPermissionOption,
} from './acpAgentSession';
import type { AcpRpcMessage } from './acpStdioClient';
import { AcpServerRequestError } from './acpStdioClient';
import type { NormalizeImageOptions } from './input';
import { normalizeImage } from './input';

const GROK_ACP_TRANSPORT = 'acp-stdio' as const;
const GROK_MODEL_FLAGS = ['-m', '--model'] as const;
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

export interface GrokAcpSessionOptions extends AcpAgentSessionOptions {
  prompt: GrokAcpContentBlock[];
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

/** Grok Build's ACP v1 lifecycle (auth + `_meta` extensions) on the shared session base. */
export class GrokAcpSession extends AcpAgentSession<AcpInitializeResult, GrokAcpSessionOptions> {
  constructor(options: GrokAcpSessionOptions) {
    super(options, {
      args: buildGrokAcpArgs(options.args),
      pipeline: { agentType: 'grok-build', cwd: options.cwd },
      processLabel: 'Grok Build ACP',
      transport: GROK_ACP_TRANSPORT,
    });
  }

  get sessionId(): string | undefined {
    return this.acpSessionId;
  }

  protected buildInitializeParams(): unknown {
    return {
      _meta: {
        clientType: 'lobehub',
        clientVersion: this.options.clientVersion,
      },
      clientCapabilities: { fs: {}, terminal: false },
      protocolVersion: ACP_PROTOCOL_VERSION,
    };
  }

  protected validateInitialized(initialized: AcpInitializeResult): void {
    if (
      initialized.protocolVersion !== ACP_PROTOCOL_VERSION &&
      initialized.protocolVersion !== String(ACP_PROTOCOL_VERSION)
    ) {
      throw new Error(
        `Unsupported Grok Build ACP protocol version: ${String(initialized.protocolVersion)}`,
      );
    }
  }

  protected async establishSession(initialized: AcpInitializeResult): Promise<string> {
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
    const model = getAnyCliFlagValue(this.options.args, GROK_MODEL_FLAGS)?.trim();
    const effort = getAnyCliFlagValue(this.options.args, GROK_BUILD_REASONING_EFFORT_FLAGS)?.trim();
    if (this.options.resumeSessionId) {
      await this.client.request('session/load', {
        _meta: {
          noReplay: true,
          ...(effort && !model ? { reasoningEffort: effort } : {}),
        },
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

    if (this.options.resumeSessionId && model) {
      await this.client.request('session/set_model', {
        ...(effort ? { _meta: { reasoningEffort: effort } } : {}),
        modelId: model,
        sessionId: acpSessionId,
      });
    }

    this.acpSessionId = acpSessionId;
    this.options.onSessionId(acpSessionId);
    return acpSessionId;
  }

  protected buildPromptParams(sessionId: string): unknown {
    return {
      _meta: { promptId: this.options.operationId },
      prompt: this.options.prompt,
      sessionId,
    };
  }

  protected override buildCancelParams(sessionId: string): unknown {
    return {
      _meta: { cancelTrigger: 'ctrl_c' },
      sessionId,
    };
  }

  protected async handleAgentMessage(message: AcpRpcMessage): Promise<void> {
    if (isAcpReplayMessage(message)) return;
    await this.pushToPipeline(message);
  }

  protected handleServerRequest(message: AcpRpcMessage): unknown {
    switch (message.method) {
      case 'session/request_permission': {
        const optionId = selectAcpPermissionOption(message.params, [
          ({ kind }) => kind === 'allow_always',
          ({ kind }) => kind === 'allow_once',
        ]);
        return {
          outcome: optionId ? { optionId, outcome: 'selected' } : { outcome: 'cancelled' },
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
}
