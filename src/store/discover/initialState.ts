import type { PluginSliceState } from './slices/plugin/initialState';
import { initialPluginSliceState } from './slices/plugin/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = PluginSliceState;

export const initialState: DiscoverStoreState = {
  ...initialPluginSliceState,
};
