import type {
  ClaudeCodeQuotaSnapshot,
  CodexQuotaSnapshot,
  CodexRateLimitResetResult,
} from '@lobechat/electron-client-ipc';
import type {
  HeterogeneousAgentModelCatalog,
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
    resumeSessionId?: string;
    useClaudeCodeSdk?: boolean;
  }) {
    return this.ipc.heterogeneousAgent.startSession(params);
  }

  async sendPrompt(params: {
    agentId?: string;
    imageList?: Array<{ id: string; url: string }>;
    operationId: string;
    prompt: string;
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
