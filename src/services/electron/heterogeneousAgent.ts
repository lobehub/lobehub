import type { ClaudeCodeQuotaSnapshot, CodexQuotaSnapshot } from '@lobechat/electron-client-ipc';

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
  }) {
    return this.ipc.heterogeneousAgent.startSession(params);
  }

  async sendPrompt(
    sessionId: string,
    prompt: string,
    operationId: string,
    imageList?: Array<{ id: string; url: string }>,
    systemContext?: string,
  ) {
    return this.ipc.heterogeneousAgent.sendPrompt({
      imageList,
      operationId,
      prompt,
      sessionId,
      systemContext,
    });
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

  async getCodexQuota(params?: {
    command?: string;
    env?: Record<string, string>;
  }): Promise<CodexQuotaSnapshot> {
    return this.ipc.heterogeneousAgent.getCodexQuota(params);
  }

  async getClaudeCodeQuota(params?: {
    env?: Record<string, string>;
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
