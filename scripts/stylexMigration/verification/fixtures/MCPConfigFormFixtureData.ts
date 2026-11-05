const notExercised = async () => {
  throw new Error('BUSINESS_MUTATION_OUTSIDE_STYLE_FIXTURE');
};

const toolState = {
  installMCPPlugin: notExercised,
  updateMCPInstallProgress: () => {},
  updatePluginSettings: notExercised,
};

export const useToolStore = Object.assign(
  <T>(selector?: (state: typeof toolState) => T) => (selector ? selector(toolState) : toolState),
  { getState: () => toolState },
);

export const pluginSelectors = { getPluginSettingsById: () => () => ({}) };
