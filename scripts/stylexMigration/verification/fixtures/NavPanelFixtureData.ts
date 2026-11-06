const notExercised = () => {
  throw new Error('BUSINESS_ACTION_OUTSIDE_STYLE_FIXTURE');
};

const globalState = { toggleLeftPanel: notExercised };

export const useGlobalStore = <T>(selector: (state: typeof globalState) => T): T =>
  selector(globalState);
export const systemStatusSelectors = { showLeftPanel: () => true };

export const useUserStore = <T>(selector: (state: object) => T): T => selector({});
export const settingsSelectors = { getHotkeyById: () => () => undefined };

export const isMacOS = () => false;

export const useActiveWorkspaceSlug = () => null;
export const buildWorkspaceAwarePath = (path: string) => path;
export const appNavigate = notExercised;
export const useWorkspaceAwareNavigate = () => notExercised;
