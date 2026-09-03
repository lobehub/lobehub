const DATABASE_NAME = 'lobehub-pptx-editor';
const STORE_NAME = 'drafts';
const DATABASE_VERSION = 1;

interface PptxDraftRecord {
  bytes: ArrayBuffer;
  savedAt: number;
  sourceUrl: string;
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error('Unable to open PPTX draft storage'));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

const transact = async <T>(
  mode: IDBTransactionMode,
  run: (
    store: IDBObjectStore,
    resolve: (value: T) => void,
    reject: (error: unknown) => void,
  ) => void,
) => {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('PPTX draft storage failed'));
    };
    run(transaction.objectStore(STORE_NAME), resolve, reject);
  });
};

export const loadPptxDraft = async (key: string, sourceUrl: string) => {
  const record = await transact<PptxDraftRecord | undefined>(
    'readonly',
    (store, resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as PptxDraftRecord | undefined);
    },
  );
  return record?.sourceUrl === sourceUrl ? record : undefined;
};

export const savePptxDraft = async (key: string, sourceUrl: string, bytes: ArrayBuffer) =>
  transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(
      { bytes, savedAt: Date.now(), sourceUrl } satisfies PptxDraftRecord,
      key,
    );
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });

export const removePptxDraft = async (key: string) =>
  transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
