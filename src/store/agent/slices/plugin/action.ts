import { produce } from 'immer';
import { type StateCreator } from 'zustand/vanilla';

import { agentSelectors } from '../../selectors';
import type { AgentStore } from '../../store';

/**
 * Plugin Slice Actions
 * Handles plugin toggle operations
 */
export interface PluginSliceAction {
  removePlugin: (id: string) => Promise<void>;
  togglePlugin: (id: string, open?: boolean) => Promise<void>;
}

export const createPluginSlice: StateCreator<
  AgentStore,
  [['zustand/devtools', never]],
  [],
  PluginSliceAction
> = (set, get) => ({
  removePlugin: async (id) => {
    await get().togglePlugin(id, false);
  },

  togglePlugin: async (id, open) => {
    const originConfig = agentSelectors.currentAgentConfig(get());

    const config = produce(originConfig, (draft) => {
      draft.plugins = produce(draft.plugins || [], (plugins) => {
        const index = plugins.indexOf(id);
        const shouldOpen = open !== undefined ? open : index === -1;

        if (shouldOpen) {
          // If open is true or id doesn't exist in plugins, add it
          if (index === -1) {
            plugins.push(id);
          }
        } else {
          // If open is false or id exists in plugins, remove it
          if (index !== -1) {
            plugins.splice(index, 1);
          }
        }
      });
    });

    await get().updateAgentConfig(config);
  },
});
