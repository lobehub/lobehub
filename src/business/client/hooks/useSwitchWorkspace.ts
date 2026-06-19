import { useWorkspaces } from './useWorkspaces';
import { setActiveWorkspaceSnapshot } from './workspaceState';

export interface SwitchWorkspaceActions {
  switchToPersonal: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
}

const switchToPersonal = async (): Promise<void> => {
  setActiveWorkspaceSnapshot({ id: null, slug: null });
};

/**
 * Workspace switch invoked from imperative call sites that represent an
 * explicit user choice (e.g. switcher click, wizard landing, accept-invite,
 * post-leave redirect). Implementations may attach side effects appropriate
 * to the user-intent semantics.
 */
export const useSwitchWorkspace = (): SwitchWorkspaceActions => {
  const workspaces = useWorkspaces();

  return {
    switchToPersonal,
    switchWorkspace: async (id: string) => {
      const workspace = workspaces.find((item) => item.id === id);
      setActiveWorkspaceSnapshot({ id, slug: workspace?.slug ?? null });
    },
  };
};

/**
 * Workspace switch invoked from passive reconciliation sources (e.g. URL
 * sync) where the active workspace is being aligned with external state
 * rather than chosen by the user. Implementations must not attach
 * user-intent side effects.
 */
export const useSilentSwitchWorkspace = (): SwitchWorkspaceActions => useSwitchWorkspace();
