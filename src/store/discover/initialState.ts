import { type SocialSliceState } from './slices/social/initialState';
import { initialSocialSliceState } from './slices/social/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = SocialSliceState;

export const initialState: DiscoverStoreState = {
  ...initialSocialSliceState,
};
