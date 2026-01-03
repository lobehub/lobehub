import { DEFAULT_AGENT_LOBE_SESSION, INBOX_SESSION_ID } from '@/const/session';
import { sessionHelpers } from '@/store/session/slices/session/helpers';
import { type MetaData } from '@/types/meta';
import {
  type CustomSessionGroup,
  type GroupMemberWithAgent,
  type LobeGroupSession,
  type LobeSession,
  type LobeSessions,
} from '@/types/session';

import { type SessionStore } from '../../../store';

const defaultSessions = (s: SessionStore): LobeSessions => s.defaultSessions;

// Limit default sessions for sidebar display based on page size
const defaultSessionsLimited =
  (pageSize: number) =>
  (s: SessionStore): LobeSessions =>
    s.defaultSessions.slice(0, pageSize);

const defaultSessionsCount = (s: SessionStore): number => s.defaultSessions.length;

const pinnedSessions = (s: SessionStore): LobeSessions => s.pinnedSessions;
const customSessionGroups = (s: SessionStore): CustomSessionGroup[] => s.customSessionGroups;

const allSessions = (s: SessionStore): LobeSessions => s.sessions;

const getSessionById =
  (id: string) =>
  (s: SessionStore): LobeSession =>
    sessionHelpers.getSessionById(id, allSessions(s));

const getSessionMetaById =
  (id: string) =>
  (s: SessionStore): MetaData => {
    const session = getSessionById(id)(s);

    if (!session) return {};
    return session.meta;
  };

const currentSession = (s: SessionStore): LobeSession | undefined => {
  if (!s.activeId) return;

  return allSessions(s).find((i) => i.id === s.activeId);
};

const currentSessionSafe = (s: SessionStore): LobeSession => {
  return currentSession(s) || DEFAULT_AGENT_LOBE_SESSION;
};

const hasCustomAgents = (s: SessionStore) => defaultSessions(s).length > 0;

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

// use to judge whether a session is fully activated
const isSomeSessionActive = (s: SessionStore) => !!s.activeId && isSessionListInit(s);

export const sessionSelectors = {
  currentGroupAgents,
  currentSession,
  currentSessionSafe,
  customSessionGroups,
  defaultSessions,
  defaultSessionsCount,
  defaultSessionsLimited,
  getSessionById,
  getSessionMetaById,
  hasCustomAgents,
  isCurrentSessionGroupSession,
  isInboxSession,
  isSessionListInit,
  isSomeSessionActive,
  pinnedSessions,
};
