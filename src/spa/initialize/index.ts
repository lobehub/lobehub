import { hydrateAppSWRCache } from '@/libs/swr/appCacheProvider';

const appLog = (...args: unknown[]) => {
  if (__DEV__) console.info('[SPA Initialize]', ...args);
};

const apm = async <T>(label: string, task: () => Promise<T> | T): Promise<T> => {
  const start = Date.now();
  const result = await task();
  appLog(`${label} took ${Date.now() - start}ms`);
  return result;
};

export const initializeApp = async (): Promise<void> => {
  const start = Date.now();

  await apm('hydrateSWRCache', hydrateAppSWRCache);

  appLog('done', `${Date.now() - start}ms`);
};
