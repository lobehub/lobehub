const DB_NAME = 'lobehub-office-drafts';
const STORE_NAME = 'docx';

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const keyOf = (fileId: string, sourceUrl: string) => `${fileId}:${sourceUrl}`;

export const loadDocxDraft = async (fileId: string, sourceUrl: string) => {
  const database = await openDatabase();
  return new Promise<ArrayBuffer | undefined>((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME)
      .objectStore(STORE_NAME)
      .get(keyOf(fileId, sourceUrl));
    request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
};

export const saveDocxDraft = async (fileId: string, sourceUrl: string, bytes: ArrayBuffer) => {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .put(bytes, keyOf(fileId, sourceUrl));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
};
