const emptyState = {} as never;

// Renderable stand-in, not a throwing proxy: shared components read the viewer
// profile during SSR and must see "signed out", not a crash. The client store
// takes over on hydration.
export const useUserStore = <T = unknown>(selector?: (state: never) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useUserStore.getState = () => emptyState;

export const getUserStoreState = () => emptyState;
