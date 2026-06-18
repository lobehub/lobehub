import { getLLMConfig } from '@/envs/llm';

interface KeyStore {
  index: number;
  keyLen: number;
  keys: string[];
}

export class ApiKeyManager {
  private _cache: Map<string, KeyStore> = new Map();

  private _mode: string;

  constructor() {
    const { API_KEY_SELECT_MODE: mode = 'random' } = getLLMConfig();

    this._mode = mode;
  }

  private getKeyStore(apiKeys: string) {
    let store = this._cache.get(apiKeys);

    if (!store) {
      const keys = apiKeys.split(',').filter((_) => !!_.trim());

      store = { index: 0, keyLen: keys.length, keys } as KeyStore;
      this._cache.set(apiKeys, store);
    }

    return store;
  }

  pick(apiKeys: string = '') {
    if (!apiKeys) return '';

    const store = this.getKeyStore(apiKeys);
    let index = 0;

    if (this._mode === 'turn') index = store.index++ % store.keyLen;
    if (this._mode === 'random') index = Math.floor(Math.random() * store.keyLen);

    return store.keys[index];
  }
}

export default new ApiKeyManager();
