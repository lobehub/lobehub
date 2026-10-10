import type { ModelSliceState } from './slices/model/initialState';
import { initialModelSliceState } from './slices/model/initialState';
import type { ProviderSliceState } from './slices/provider/initialState';
import { initialProviderSliceState } from './slices/provider/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = ProviderSliceState & ModelSliceState;

export const initialState: DiscoverStoreState = {
  ...initialProviderSliceState,
  ...initialModelSliceState,
};
