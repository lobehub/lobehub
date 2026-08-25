const emptyState = {} as never;

export const useFileStore = <T = unknown>(selector?: (state: never) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useFileStore.getState = () => emptyState;

const passiveSelectors = new Proxy({}, { get: () => () => undefined }) as never;

export const documentSelectors = passiveSelectors;
export const fileChatSelectors = passiveSelectors;
export const fileManagerSelectors = passiveSelectors;
export const filesSelectors = passiveSelectors;
export const getChunkTargetId = () => undefined;
