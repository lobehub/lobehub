import { produce } from 'immer';
import type { PartialDeep } from 'type-fest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import type { LobeAgentConfig } from '@/types/agent';
import { merge } from '@/utils/merge';

export type ConfigDispatch =
  { config: PartialDeep<LobeAgentConfig>; type: 'update' } | { type: 'reset' };

export const configReducer = (state: LobeAgentConfig, payload: ConfigDispatch): LobeAgentConfig => {
  switch (payload.type) {
    case 'update': {
      return produce(state, (draftState) => {
        return merge(draftState, payload.config);
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
