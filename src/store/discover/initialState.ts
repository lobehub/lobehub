import type { GroupAgentSliceState } from './slices/groupAgent/initialState';
import { initialGroupAgentSliceState } from './slices/groupAgent/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = GroupAgentSliceState;

export const initialState: DiscoverStoreState = {
  ...initialGroupAgentSliceState,
};
