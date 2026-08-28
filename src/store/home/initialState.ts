import { type AgentListState } from './slices/agentList/initialState';
import { initialAgentListState } from './slices/agentList/initialState';
import { type HomeInputState } from './slices/homeInput/initialState';
import { initialHomeInputState } from './slices/homeInput/initialState';
import { type LabelState } from './slices/label/initialState';
import { initialLabelState } from './slices/label/initialState';
import { type RecentState } from './slices/recent/initialState';
import { initialRecentState } from './slices/recent/initialState';
import { type SidebarUIState } from './slices/sidebarUI/initialState';
import { initialSidebarUIState } from './slices/sidebarUI/initialState';

export interface HomeStoreState
  extends AgentListState, RecentState, HomeInputState, LabelState, SidebarUIState {}

export const initialState: HomeStoreState = {
  ...initialAgentListState,
  ...initialRecentState,
  ...initialHomeInputState,
  ...initialLabelState,
  ...initialSidebarUIState,
};
