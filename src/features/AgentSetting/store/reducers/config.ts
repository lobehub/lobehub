import { getPluginMode, upsertPluginMode } from '@lobechat/types';
import { produce } from 'immer';
import type { PartialDeep } from 'type-fest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import type { LobeAgentConfig } from '@/types/agent';
import { merge } from '@/utils/merge';

export type ConfigDispatch =
  | { config: PartialDeep<LobeAgentConfig>; type: 'update' }
  | { pluginId: string; state?: boolean; type: 'togglePlugin' }
  | { type: 'reset' };

export const configReducer = (state: LobeAgentConfig, payload: ConfigDispatch): LobeAgentConfig => {
  switch (payload.type) {
    case 'update': {
      return produce(state, (draftState) => {
        return merge(draftState, payload.config);
      });
    }

    case 'togglePlugin': {
      return produce(state, (config) => {
        const { pluginId: id, state } = payload;
        const isPinned = getPluginMode(config.plugins, id) === 'pinned';
        const shouldPin = typeof state === 'undefined' ? !isPinned : state;

        // upsertPluginMode preserves an already-matching entry as-is and
        // flips a disabled entry back to pinned in place, instead of
        // blindly pushing a duplicate bare-string identifier.
        config.plugins = upsertPluginMode(config.plugins, id, shouldPin ? 'pinned' : 'auto');
      });
    }

    case 'reset': {
      return DEFAULT_AGENT_CONFIG;
    }

    default: {
      return state;
    }
  }
};
