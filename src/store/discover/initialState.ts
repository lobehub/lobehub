import type { AssistantSliceState } from './slices/assistant/initialState';
import { initialAssistantSliceState } from './slices/assistant/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = AssistantSliceState;

export const initialState: DiscoverStoreState = {
  ...initialAssistantSliceState,
};
