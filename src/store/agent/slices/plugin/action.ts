import { produce } from 'immer';

import { type StoreSetter } from '@/store/types';

import { agentSelectors } from '../../selectors';
import { type AgentStore } from '../../store';

/**
 * Plugin Slice Actions
 * Handles plugin toggle operations
 */

type Setter = StoreSetter<AgentStore>;
export const createPluginSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new PluginSliceActionImpl(set, get, _api);

export class PluginSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  removePlugin = async (id: string): Promise<void> => {
    await this.#get().togglePlugin(id, false);
  };

  togglePlugin = async (id: string, open?: boolean): Promise<void> => {
    const originConfig = agentSelectors.currentAgentConfig(this.#get());

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

    await this.#get().updateAgentConfig(config);
  };
}

export type PluginSliceAction = Pick<PluginSliceActionImpl, keyof PluginSliceActionImpl>;
