const DATABASE_NAME = 'lobehub-xlsx-editor';
const STORE_NAME = 'drafts';

interface XlsxDraftRecord {
  bytes: ArrayBuffer;
  sourceUrl: string;
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onerror = () => reject(request.error || new Error('Unable to open XLSX draft storage'));
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
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
    transaction.onerror = () => reject(transaction.error);
    run(transaction.objectStore(STORE_NAME), resolve, reject);
  });
};

export const loadXlsxDraft = async (key: string, sourceUrl: string) => {
  const record = await transact<XlsxDraftRecord | undefined>(
    'readonly',
    (store, resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as XlsxDraftRecord | undefined);
    },
  );
  return record?.sourceUrl === sourceUrl ? record.bytes : undefined;
};

export const saveXlsxDraft = (key: string, sourceUrl: string, bytes: ArrayBuffer) =>
  transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put({ bytes, sourceUrl } satisfies XlsxDraftRecord, key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
