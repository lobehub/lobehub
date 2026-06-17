export interface SwitchWorkspaceActions {
  switchToPersonal: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
}

const noop = async (): Promise<void> => {};

/**
 * User-intent workspace switch. Cloud overrides this to also persist the
 * target as the user's "last visited" so the next tab / fresh session lands
 * here. Open-source stub is a no-op.
 */
export const useSwitchWorkspace = (): SwitchWorkspaceActions => ({
  switchToPersonal: noop,
  switchWorkspace: noop,
});

/**
 * System-driven workspace switch — does NOT record "last visited". Used by
 * URL sync and other passive reconciliation sources where the active
 * workspace is being aligned with external state rather than chosen by the
 * user. Open-source stub is a no-op.
 */
export const useSilentSwitchWorkspace = (): SwitchWorkspaceActions => ({
  switchToPersonal: noop,
  switchWorkspace: noop,
});
