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

  async sendPrompt(sessionId: string, prompt: string) {
    return this.ipc.heterogeneousAgent.sendPrompt({ prompt, sessionId });
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
}

export const heterogeneousAgentService = new HeterogeneousAgentService();
