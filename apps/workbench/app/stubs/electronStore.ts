const emptyState = {};

// Renderable stand-in, not a throwing proxy: shared components may call the
// hook during SSR and must see "desktop features off", not a crash.
export const useElectronStore = <T = unknown>(selector?: (state: typeof emptyState) => T): T =>
  selector ? selector(emptyState) : (emptyState as T);

useElectronStore.getState = () => emptyState;

export const getElectronStoreState = () => emptyState;
