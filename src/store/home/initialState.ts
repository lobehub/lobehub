import { type AgentListState, initialAgentListState } from './slices/agentList/initialState';
import { type HomeInputState, initialHomeInputState } from './slices/homeInput/initialState';
import { type RecentState, initialRecentState } from './slices/recent/initialState';
import { type SidebarUIState, initialSidebarUIState } from './slices/sidebarUI/initialState';

export interface HomeStoreState
  extends AgentListState, RecentState, HomeInputState, SidebarUIState {}

export const initialState: HomeStoreState = {
  ...initialAgentListState,
  ...initialRecentState,
  ...initialHomeInputState,
  ...initialSidebarUIState,
};
