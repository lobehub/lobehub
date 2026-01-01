import { type HomeInputState, initialHomeInputState } from './slices/homeInput/initialState';
import { type RecentState, initialRecentState } from './slices/recent/initialState';
import { type SessionState, initialSessionState } from './slices/session/initialState';
import { type SessionGroupState, initSessionGroupState } from './slices/sessionGroup/initialState';

export interface SessionStoreState
  extends SessionGroupState, SessionState, RecentState, HomeInputState {}

export const initialState: SessionStoreState = {
  ...initSessionGroupState,
  ...initialSessionState,
  ...initialRecentState,
  ...initialHomeInputState,
};
