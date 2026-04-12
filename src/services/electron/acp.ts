import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Renderer-side service for managing external agent processes via Electron IPC.
 */
class ACPService {
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
    return this.ipc.acp.startSession(params);
  }

  async sendPrompt(sessionId: string, prompt: string) {
    return this.ipc.acp.sendPrompt({ prompt, sessionId });
  }

  async cancelSession(sessionId: string) {
    return this.ipc.acp.cancelSession({ sessionId });
  }

  async stopSession(sessionId: string) {
    return this.ipc.acp.stopSession({ sessionId });
  }

  async getSessionInfo(sessionId: string) {
    return this.ipc.acp.getSessionInfo({ sessionId });
  }
}

export const acpService = new ACPService();
