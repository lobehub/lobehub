// `src/store/tree/actions.ts` reaches the ResourceManager store when it refreshes
// the sidebar's hierarchy search, and that store reads these fields off the file
// store state. On the server there is no query / folder to scope, so they are inert.
const emptyState = {
  queryParams: undefined,
  uploadWithProgress: async () => undefined,
  useFetchFolderBreadcrumb: () => undefined,
};

export const useFileStore = <T = unknown>(selector?: (state: typeof emptyState) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useFileStore.getState = () => emptyState;
// `src/store/tree/store.ts` mirrors the explorer list into the sidebar tree at
// module scope; on the server there is no explorer to mirror.
useFileStore.subscribe = () => () => {};

export const documentSelectors = {};
export const fileChatSelectors = {};
export const fileManagerSelectors = {
  // `selectors.getCurrentFile` resolves the previewed row through this selector.
  getFileById: () => () => undefined,
};
export const filesSelectors = {};
export const getChunkTargetId = () => undefined;
