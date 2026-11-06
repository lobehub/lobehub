const noop = () => {};
const notExercised = () => {
  throw new Error('BUSINESS_SURFACE_OUTSIDE_STYLE_FIXTURE');
};

export const useCommandMenu = () => ({ handleBack: noop, handleThemeChange: noop });

export const useCommandMenuContext = () => ({
  activeAgentId: undefined,
  menuContext: 'general',
  page: 'theme',
  pages: ['theme'],
  search: '',
  selectedAgent: undefined,
  setSearch: noop,
  setSelectedAgent: noop,
  setTypeFilter: noop,
  typeFilter: undefined,
});

export const useTheme = () => ({ theme: 'dark' });

export const agentDisplayName = notExercised;
export const agentSelectors = { getAgentMetaById: notExercised };
export const useAgentStore = <T,>(selector: (state: object) => T): T => selector({});

const UnmountedAgentAvatar = () => notExercised();
export default UnmountedAgentAvatar;
