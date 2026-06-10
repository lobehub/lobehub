export interface SwitchWorkspaceActions {
  switchToPersonal: () => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
}

const noop = async (): Promise<void> => {};

export const useSwitchWorkspace = (): SwitchWorkspaceActions => ({
  switchToPersonal: noop,
  switchWorkspace: noop,
});
