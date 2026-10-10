import type { ProviderSliceState } from './slices/provider/initialState';
import { initialProviderSliceState } from './slices/provider/initialState';
import type { SkillSliceState } from './slices/skill/initialState';
import { initialSkillSliceState } from './slices/skill/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = ProviderSliceState & SkillSliceState;

export const initialState: DiscoverStoreState = {
  ...initialProviderSliceState,
  ...initialSkillSliceState,
};
