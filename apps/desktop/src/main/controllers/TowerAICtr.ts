import { loginWithCredentials } from '@/modules/towerai/auth';
import { towerAIStore } from '@/modules/towerai/store';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:TowerAICtr');

export default class TowerAICtr extends ControllerModule {
  static override readonly groupName = 'towerai';

  @IpcMethod()
  async getState() {
    return towerAIStore.getAuthState();
  }

  @IpcMethod()
  async getToken() {
    const state = towerAIStore.get();
    if (!state.token) {
      throw new Error('Tower AI: not logged in. Configure credentials in Settings → Providers → Tower AI');
    }
    return { authToken: state.authToken, token: state.token };
  }

  @IpcMethod()
  async setManualToken(params: { authToken?: string; token: string }) {
    towerAIStore.set({ authToken: params.authToken || '', token: params.token });
    logger.info('Tower AI manual token set');
    return { ok: true };
  }

  @IpcMethod()
  async login(params: { baseUrl?: string; headless?: boolean; password: string; username: string }) {
    logger.info('Tower AI auto-login started');
    try {
      const credentials = await loginWithCredentials({
        baseUrl: params.baseUrl,
        headless: params.headless ?? true,
        oaPassword: params.password,
        oaUsername: params.username,
      });
      logger.info('Tower AI auto-login succeeded');
      return { authToken: credentials.authToken, ok: true, token: credentials.token };
    } catch (error: any) {
      logger.error('Tower AI auto-login failed:', error.message);
      throw error;
    }
  }

  @IpcMethod()
  async logout() {
    towerAIStore.clear();
    logger.info('Tower AI logged out');
    return { ok: true };
  }
}
