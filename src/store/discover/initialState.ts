import { type UserSliceState } from './slices/user/initialState';
import { initialUserSliceState } from './slices/user/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = UserSliceState;

export const initialState: DiscoverStoreState = {
  ...initialUserSliceState,
};
