import {
  KeyValueReplicaStorage,
  LocalStorageReplicaStorage,
  type ReplicaRow,
  type ReplicaRowCodec,
} from 'local-replica';
import superjson from 'superjson';

import { localDatabase } from '@/libs/localDatabase';

/**
 * The app's replica storages. This module imports only the package, the local
 * database and superjson so stores inside the `@/libs/replica` import cycle
 * (the user store) can construct a storage without pulling in the index.
 */

interface AppIndexedDBStorageOptions {
  namespace: string;
}

const COLLECTION = 'query-projections';

/** Replica rows in the app's local database (IndexedDB on the web, SQLite in Electron). */
export class AppIndexedDBStorage<T> extends KeyValueReplicaStorage<T> {
  constructor({ namespace }: AppIndexedDBStorageOptions) {
    super({
      namespace,
      // Resolve `localDatabase` per call: the active adapter can be swapped at boot.
      store: {
        delete: (key) => localDatabase.delete(COLLECTION, key),
        get: (key) => localDatabase.get(COLLECTION, key),
        initialize: () => localDatabase.initialize(),
        set: (key, value) => localDatabase.set(COLLECTION, key, value),
      },
    });
  }
}

interface AppLocalStorageOptions<T> {
  codec?: ReplicaRowCodec<T>;
  namespace: string;
}

/** Replica rows in `localStorage`, serialized with superjson so `Date` and friends survive. */
export class AppLocalStorage<T> extends LocalStorageReplicaStorage<T> {
  constructor({ codec, namespace }: AppLocalStorageOptions<T>) {
    super({
      codec: codec ?? {
        parse: superjson.parse<ReplicaRow<T>>,
        stringify: superjson.stringify,
      },
      namespace,
    });
  }
}
