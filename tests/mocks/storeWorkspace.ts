// Stub for `@/store/workspace`. The real workspace store lives in the cloud
// repo; submodule-only tests don't have it on disk, so vite import-analysis
// fails without this alias.
//
// Returns a "no active workspace" state, which makes WorkspaceLink /
// useWorkspaceAwareNavigate behave like plain react-router. Tests that need
// an active workspace can spy on these selectors with `vi.spyOn`.

export const workspaceSelectors = {
  activeWorkspace: () => null,
  activeWorkspaceId: () => null,
  hasActiveWorkspace: () => false,
  isContextReady: () => true,
  isLoading: () => false,
  isMember: () => false,
  isOwner: () => false,
  isSwitchingWorkspace: () => false,
  isViewer: () => false,
  members: () => [],
  myRole: () => null,
  primaryOwnerId: () => null,
  workspaces: () => [],
};

const noopState = {
  activeWorkspaceId: null,
  isSwitchingWorkspace: false,
  isWorkspaceLoading: false,
  members: [],
  myRole: null,
  workspaces: [],
};

type Selector<T> = (state: typeof noopState) => T;

export function useWorkspaceStore<T>(selector?: Selector<T>): T | typeof noopState {
  return selector ? selector(noopState) : noopState;
}

useWorkspaceStore.getState = () => noopState;
useWorkspaceStore.setState = () => undefined;
useWorkspaceStore.subscribe = () => () => undefined;
