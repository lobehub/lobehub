const emptyState = {
  uploadWithProgress: async () => undefined,
};

export const useFileStore = <T = unknown>(selector?: (state: typeof emptyState) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useFileStore.getState = () => emptyState;

export const documentSelectors = {};
export const fileChatSelectors = {};
export const fileManagerSelectors = {};
export const filesSelectors = {};
export const getChunkTargetId = () => undefined;
