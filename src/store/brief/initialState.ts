import { type BriefListState, initialBriefListState } from './slices/list/initialState';

export interface BriefStoreState extends BriefListState {}

export const initialState: BriefStoreState = {
  ...initialBriefListState,
};
