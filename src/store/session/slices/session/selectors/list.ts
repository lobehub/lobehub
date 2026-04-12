import { INBOX_SESSION_ID } from '@/const/session';
import { sessionHelpers } from '@/store/session/slices/session/helpers';
import {
  type CustomSessionGroup,
  type GroupMemberWithAgent,
  type LobeGroupSession,
  type LobeSession,
  type LobeSessions,
} from '@/types/session';

import { type SessionStore } from '../../../store';

const defaultSessions = (s: SessionStore): LobeSessions => s.defaultSessions;

const pinnedSessions = (s: SessionStore): LobeSessions => s.pinnedSessions;
const customSessionGroups = (s: SessionStore): CustomSessionGroup[] => s.customSessionGroups;

const allSessions = (s: SessionStore): LobeSessions => s.sessions;

const getSessionById =
  (id: string) =>
  (s: SessionStore): LobeSession =>
    sessionHelpers.getSessionById(id, allSessions(s));

const currentSession = (s: SessionStore): LobeSession | undefined => {
  if (!s.activeId) return;

  return allSessions(s).find((i) => i.id === s.activeId);
};

const isInboxSession = (s: SessionStore) => s.activeId === INBOX_SESSION_ID;

const isCurrentSessionGroupSession = (s: SessionStore): boolean => {
  const session = currentSession(s);
  return session?.type === 'group';
};

const currentGroupAgents = (s: SessionStore): GroupMemberWithAgent[] => {
  const session = currentSession(s) as LobeGroupSession;

  if (session && session.type !== 'group') return [];

  return session ? (session.members ?? []) : [];
};

const isSessionListInit = (s: SessionStore) => s.isSessionsFirstFetchFinished;

const isSomeSessionActive = (s: SessionStore) => !!s.activeId && isSessionListInit(s);

export const sessionSelectors = {
  currentGroupAgents,
  currentSession,
  customSessionGroups,
  defaultSessions,
  getSessionById,
  isCurrentSessionGroupSession,
  isInboxSession,
  isSessionListInit,
  isSomeSessionActive,
  pinnedSessions,
};
