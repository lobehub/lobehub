import type {
  ClaudeCodeQuotaSnapshot,
  CodexQuotaSnapshot,
  CodexRateLimitResetResult,
  KimiCodeQuotaSnapshot,
} from '@lobechat/electron-client-ipc';
import type { HeterogeneousProviderBindingReference } from '@lobechat/heterogeneous-agents';
import type {
  HeterogeneousAgentModelCatalog,
  HeteroSessionImportMessage,
  ListHeterogeneousAgentModelsParams,
} from '@lobechat/types';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Renderer-side service for managing heterogeneous agent processes via Electron IPC.
 */
class HeterogeneousAgentService {
  private get ipc() {
    return ensureElectronIpc();
  }

  async startSession(params: {
    agentType?: string;
    args?: string[];
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    initialModel?: string;
    providerBinding?: HeterogeneousProviderBindingReference;
    resumeSessionId?: string;
    useClaudeCodeSdk?: boolean;
    useCodexAppServer?: boolean;
  }) {
    return this.ipc.heterogeneousAgent.startSession(params);
  }

  async sendPrompt(params: {
    agentId?: string;
    imageList?: Array<{ id: string; url: string }>;
    operationId: string;
    prompt: string;
    /**
     * Replay the session's on-disk transcript instead of spawning the CLI.
     * Desktop main resolves with `{ replay: { complete } }`.
     */
    replayTranscript?: boolean;
    /** Prior turns used to rebuild a GC-ed Claude Code transcript before `--resume`. */
    resumeReplayMessages?: HeteroSessionImportMessage[];
    sessionId: string;
    systemContext?: string;
    topicId?: string;
  }) {
    return this.ipc.heterogeneousAgent.sendPrompt(params);
  }

  async cancelSession(sessionId: string) {
    return this.ipc.heterogeneousAgent.cancelSession({ sessionId });
  }

  async stopSession(sessionId: string) {
    return this.ipc.heterogeneousAgent.stopSession({ sessionId });
  }

  async getSessionInfo(sessionId: string) {
    return this.ipc.heterogeneousAgent.getSessionInfo({ sessionId });
  }

  /**
   * Local CLI runs the previous desktop process left in flight, handed over
   * once. Main reaps any surviving process before returning.
   */
  async listInterruptedRuns() {
    return this.ipc.heterogeneousAgent.listInterruptedRuns();
  }

  async listModels(
    params: ListHeterogeneousAgentModelsParams,
  ): Promise<HeterogeneousAgentModelCatalog> {
    return this.ipc.heterogeneousAgent.listModels(params);
  }

  async getCodexQuota(params?: {
    command?: string;
    env?: Record<string, string>;
    force?: boolean;
  }): Promise<CodexQuotaSnapshot> {
    return this.ipc.heterogeneousAgent.getCodexQuota(params);
  }

  async consumeCodexRateLimitResetCredit(params: {
    command?: string;
    creditId?: string;
    env?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<CodexRateLimitResetResult> {
    return this.ipc.heterogeneousAgent.consumeCodexRateLimitResetCredit(params);
  }

  async getClaudeCodeQuota(params?: {
    env?: Record<string, string>;
    force?: boolean;
  }): Promise<ClaudeCodeQuotaSnapshot> {
    return this.ipc.heterogeneousAgent.getClaudeCodeQuota(params);
  }

  async getKimiCodeQuota(params?: {
    env?: Record<string, string>;
    force?: boolean;
    kimiCodeHomePath?: string | null;
  }): Promise<KimiCodeQuotaSnapshot> {
    return this.ipc.heterogeneousAgent.getKimiCodeQuota(params);
  }

  /**
   * Identity of the Claude login a spawn with this env would use — a pure
   * local file read, safe to call once per run for usage attribution.
   */
  async getClaudeCodeIdentity(params?: {
    env?: Record<string, string>;
  }): Promise<ClaudeCodeQuotaSnapshot['identity']> {
    return this.ipc.heterogeneousAgent.getClaudeCodeIdentity(params);
  }

  /**
   * Submit the user's answer (or cancellation) for a pending CC
   * AskUserQuestion intervention. The main process routes it to the
   * matching MCP bridge so the blocked tool handler can return to CC.
   */
  async submitIntervention(params: {
    cancelReason?: 'timeout' | 'user_cancelled';
    cancelled?: boolean;
    operationId: string;
    result?: unknown;
    toolCallId: string;
  }) {
    return this.ipc.heterogeneousAgent.submitIntervention(params);
  }
}

export const heterogeneousAgentService = new HeterogeneousAgentService();
