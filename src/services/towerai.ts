import type { TowerAIAuthState, TowerAICredentials, TowerAILoginParams } from '@lobechat/electron-client-ipc';

import { resolveTowerAIEndpoint } from '@lobechat/model-runtime/providers/towerai';
import { ensureElectronIpc } from '@/utils/electron/ipc';

export type { TowerAIAuthState, TowerAICredentials };

class TowerAIService {
  async getState(): Promise<TowerAIAuthState> {
    const ipc = ensureElectronIpc();
    return (ipc as any).towerai.getState();
  }

  async getToken(): Promise<TowerAICredentials> {
    const ipc = ensureElectronIpc();
    return (ipc as any).towerai.getToken();
  }

  async login(params: TowerAILoginParams): Promise<TowerAICredentials & { ok: boolean }> {
    const ipc = ensureElectronIpc();
    return (ipc as any).towerai.login(params);
  }

  async setManualToken(token: string, authToken?: string): Promise<{ ok: boolean }> {
    const ipc = ensureElectronIpc();
    return (ipc as any).towerai.setManualToken({ authToken: authToken || '', token });
  }

  async logout(): Promise<{ ok: boolean }> {
    const ipc = ensureElectronIpc();
    return (ipc as any).towerai.logout();
  }

  /**
   * Get Tower AI credentials and resolve the correct endpoint for the given model.
   * Call this before creating a Tower AI runtime instance.
   */
  async resolveRuntimeParams(
    model: string,
    baseUrl = 'https://tower-ai.yottastudios.com',
  ): Promise<{ apiKey: string; baseURL: string }> {
    const { token } = await this.getToken();
    return {
      apiKey: token,
      baseURL: resolveTowerAIEndpoint(baseUrl, model),
    };
  }
}

export const towerAIService = new TowerAIService();
