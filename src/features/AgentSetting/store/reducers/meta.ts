import { produce } from 'immer';

import { DEFAULT_AGENT_META } from '@/const/meta';
import { type MetaData } from '@/types/meta';
import { merge } from '@/utils/merge';

export type MetaDataDispatch = { type: 'update'; value: Partial<MetaData> } | { type: 'reset' };

export const metaDataReducer = (state: MetaData, payload: MetaDataDispatch): MetaData => {
  switch (payload.type) {
    case 'update': {
      return produce(state, (draftState) => {
        return merge(draftState, payload.value);
      });
    }

    case 'reset': {
      return DEFAULT_AGENT_META;
    }
  }
};
