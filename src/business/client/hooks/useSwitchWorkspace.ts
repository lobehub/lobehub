export interface SwitchWorkspaceActions {
  switchToPersonal: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
}

const noop = async (): Promise<void> => {};

/**
 * Workspace switch invoked from imperative call sites that represent an
 * explicit user choice (e.g. switcher click, wizard landing, accept-invite,
 * post-leave redirect). Implementations may attach side effects appropriate
 * to the user-intent semantics.
 */
export const useSwitchWorkspace = (): SwitchWorkspaceActions => ({
  switchToPersonal: noop,
  switchWorkspace: noop,
});

/**
 * Workspace switch invoked from passive reconciliation sources (e.g. URL
 * sync) where the active workspace is being aligned with external state
 * rather than chosen by the user. Implementations must not attach
 * user-intent side effects.
 */
export const useSilentSwitchWorkspace = (): SwitchWorkspaceActions => ({
  switchToPersonal: noop,
  switchWorkspace: noop,
});
