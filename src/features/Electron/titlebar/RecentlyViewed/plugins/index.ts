import { agentPlugin } from './agentPlugin';
import { agentTopicPlugin } from './agentTopicPlugin';
import { communityPlugin } from './communityPlugin';
import { groupPlugin } from './groupPlugin';
import { groupTopicPlugin } from './groupTopicPlugin';
import { homePlugin } from './homePlugin';
import { imagePlugin } from './imagePlugin';
import { memoryPlugin } from './memoryPlugin';
import { pagePlugin } from './pagePlugin';
import { pluginRegistry } from './registry';
import { resourcePlugin } from './resourcePlugin';
import { settingsPlugin } from './settingsPlugin';

export { pluginRegistry } from './registry';
export * from './types';

export const loadAllRecentlyViewedPlugins = () => {
  pluginRegistry.register([
    agentPlugin,
    agentTopicPlugin,
    communityPlugin,
    groupPlugin,
    groupTopicPlugin,
    homePlugin,
    imagePlugin,
    memoryPlugin,
    pagePlugin,
    resourcePlugin,
    settingsPlugin,
  ]);
};
