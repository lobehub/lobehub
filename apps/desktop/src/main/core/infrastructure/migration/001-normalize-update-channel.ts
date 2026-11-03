import { coerceStoredUpdateChannel } from '@/modules/updater/configs';

import { defineMigration } from './defineMigration';

export default defineMigration({
  id: '001-normalize-update-channel',
  up: (store) => {
    const storedChannel = store.get('updateChannel');
    const normalizedChannel = coerceStoredUpdateChannel(storedChannel);

    if (storedChannel && storedChannel !== normalizedChannel) {
      store.set('updateChannel', normalizedChannel);
    }
  },
});
