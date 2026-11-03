import { pluginHelpers } from '../../helpers';
import { type ToolStoreState } from '../../initialState';

const isCustomPlugin = (id: string) => (s: ToolStoreState) =>
  pluginHelpers.isCustomPlugin(id, s.installedPlugins);

export const customPluginSelectors = {
  isCustomPlugin,
};
