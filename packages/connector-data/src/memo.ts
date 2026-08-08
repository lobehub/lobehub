export const createRecoverableMemo = <T>(load: () => Promise<T>) => {
  let promise: Promise<T> | undefined;

  return () => {
    promise ??= load().catch((error) => {
      promise = undefined;
      throw error;
    });
    return promise;
  };
};
