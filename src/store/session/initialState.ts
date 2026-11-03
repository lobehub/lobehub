import { type SessionState } from './slices/session/initialState';
import { initialSessionState } from './slices/session/initialState';
import { type SessionGroupState } from './slices/sessionGroup/initialState';
import { initSessionGroupState } from './slices/sessionGroup/initialState';

export interface SessionStoreState extends SessionGroupState, SessionState {}

export const initialState: SessionStoreState = {
  ...initSessionGroupState,
  ...initialSessionState,
};
