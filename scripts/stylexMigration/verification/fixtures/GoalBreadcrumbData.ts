const variant = () => new URL(location.href).searchParams.get('variant') ?? '';

const userState = { goalsEnabled: !variant().includes('single') };

export const labPreferSelectors = {
  enableGoals: (state: typeof userState) => state.goalsEnabled,
};

export const useUserStore = <T>(selector: (state: typeof userState) => T): T => selector(userState);

export const useActiveWorkspaceSlug = () => undefined;
