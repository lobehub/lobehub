const appLog = (...args: unknown[]) => {
  if (__DEV__) console.info('[SPA Initialize]', ...args);
};

export const initializeApp = async (): Promise<void> => {
  const start = Date.now();

  appLog('done', `${Date.now() - start}ms`);
};
