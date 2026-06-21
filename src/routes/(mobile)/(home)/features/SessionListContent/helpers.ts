import { type CustomSessionGroup, type LobeAgentSession, type LobeSessions } from '@/types/session';
import { LobeSessionType } from '@/types/session';

export const RECENT_CHAT_LIMIT = 5;

export const shouldHideVirtualSession = (session: LobeSessions[0], isMobile: boolean) => {
  if (isMobile) return false;

  if (session.type !== LobeSessionType.Agent) return false;

  return Boolean((session as LobeAgentSession).config?.virtual);
};

export const filterSessionsForView = (sessions: LobeSessions, isMobile: boolean): LobeSessions => {
  const filteredForDevice = isMobile
    ? sessions.filter((session) => session.type !== LobeSessionType.Group)
    : sessions;

  if (isMobile) return filteredForDevice;

  return filteredForDevice.filter((session) => !shouldHideVirtualSession(session, isMobile));
};

const getSessionTimestamp = (updatedAt: Date) => new Date(updatedAt).getTime();

const shouldHideRecentSession = (session: LobeSessions[0], isMobile: boolean) =>
  shouldHideVirtualSession(session, isMobile);

const filterRecentSessionsForView = (sessions: LobeSessions, isMobile: boolean): LobeSessions =>
  sessions.filter((session) => !shouldHideRecentSession(session, isMobile));

interface GetRecentChatSessionsParams {
  customSessionGroups?: CustomSessionGroup[];
  defaultSessions: LobeSessions;
  isMobile: boolean;
  limit?: number;
  pinnedSessions: LobeSessions;
}

export const getRecentChatSessions = ({
  customSessionGroups,
  defaultSessions,
  isMobile,
  limit = RECENT_CHAT_LIMIT,
  pinnedSessions,
}: GetRecentChatSessionsParams): LobeSessions => {
  if (limit <= 0) return [];

  const visibleSessions = [
    ...filterRecentSessionsForView(defaultSessions, isMobile),
    ...filterRecentSessionsForView(pinnedSessions, isMobile),
    ...(customSessionGroups ?? []).flatMap((group) =>
      filterRecentSessionsForView(group.children, isMobile),
    ),
  ];

  const sessionsById = new Map<string, LobeSessions[0]>();

  for (const session of visibleSessions) {
    const existingSession = sessionsById.get(session.id);
    if (
      existingSession &&
      getSessionTimestamp(existingSession.updatedAt) >= getSessionTimestamp(session.updatedAt)
    ) {
      continue;
    }

    sessionsById.set(session.id, session);
  }

  return [...sessionsById.values()]
    .sort(
      (left, right) => getSessionTimestamp(right.updatedAt) - getSessionTimestamp(left.updatedAt),
    )
    .slice(0, limit);
};
