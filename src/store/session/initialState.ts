import { type HomeInputState } from './slices/homeInput/initialState';
import { initialHomeInputState } from './slices/homeInput/initialState';
import { type RecentState } from './slices/recent/initialState';
import { initialRecentState } from './slices/recent/initialState';
import { type SessionState } from './slices/session/initialState';
import { initialSessionState } from './slices/session/initialState';
import { type SessionGroupState } from './slices/sessionGroup/initialState';
import { initSessionGroupState } from './slices/sessionGroup/initialState';

export interface SessionStoreState
  extends SessionGroupState, SessionState, RecentState, HomeInputState {}

export const initialState: SessionStoreState = {
  ...initSessionGroupState,
  ...initialSessionState,
  ...initialRecentState,
  ...initialHomeInputState,
};
