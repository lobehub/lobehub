import type Store from 'electron-store';

import { coerceStoredUpdateChannel } from '@/modules/updater/configs';
import type { ElectronMainStore } from '@/types/store';

export const STORE_SCHEMA_VERSION = '1.0.0';

export const storeMigrations = {
  '1.0.0': (store: Store<ElectronMainStore>) => {
    const storedChannel = store.get('updateChannel');
    const normalizedChannel = coerceStoredUpdateChannel(storedChannel);

    if (storedChannel && storedChannel !== normalizedChannel) {
      store.set('updateChannel', normalizedChannel);
    }
  },
};
