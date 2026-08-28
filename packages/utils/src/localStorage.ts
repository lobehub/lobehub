const PREV_KEY = 'LOBE_GLOBAL';

// LOBE_PREFERENCE for userStore
// LOBE_GLOBAL_PREFERENCE for globalStore
type StorageKey = 'LOBE_PREFERENCE' | 'LOBE_SYSTEM_STATUS';

export class AsyncLocalStorage<State> {
  private storageKey: StorageKey;

  constructor(storageKey: StorageKey) {
    this.storageKey = storageKey;

    // skip server side rendering
    if (typeof window === 'undefined') return;

    // migrate old data
    if (localStorage.getItem(PREV_KEY)) {
      const data = JSON.parse(localStorage.getItem(PREV_KEY) || '{}');

      const preference = data.state.preference;

      if (data.state?.preference) {
        localStorage.setItem('LOBE_PREFERENCE', JSON.stringify(preference));
      }
      localStorage.removeItem(PREV_KEY);
    }
  }

  async saveToLocalStorage(state: object) {
    const data = await this.getFromLocalStorage();

    localStorage.setItem(this.storageKey, JSON.stringify({ ...data, ...state }));
  }

  getFromLocalStorageSync(key: StorageKey = this.storageKey): State {
    if (typeof localStorage === 'undefined') return {} as State;

    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return {} as State;
    }
  }

  async getFromLocalStorage(key: StorageKey = this.storageKey): Promise<State> {
    return this.getFromLocalStorageSync(key);
  }
}
