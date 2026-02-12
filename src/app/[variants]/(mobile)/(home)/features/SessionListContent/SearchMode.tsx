import { memo, useMemo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useSessionStore } from '@/store/session';
import { type LobeAgentSession, type LobeSessions } from '@/types/session';
import { LobeSessionType } from '@/types/session';

import SkeletonList from '../SkeletonList';
import SessionList from './List';

const SearchMode = memo(() => {
  const [sessionSearchKeywords, useSearchSessions] = useSessionStore((s) => [
    s.sessionSearchKeywords,
    s.useSearchSessions,
  ]);

  const isMobile = useServerConfigStore(serverConfigSelectors.isMobile);

  const { data, isLoading } = useSearchSessions(sessionSearchKeywords);

  const filteredData = useMemo(() => {
    if (!data) return data;

    if (isMobile) {
      return data.filter((session: LobeSessions[0]) => session.type !== LobeSessionType.Group);
    }

    return data.filter(
      (session: LobeSessions[0]) =>
        session.type !== LobeSessionType.Agent || !(session as LobeAgentSession).config?.virtual,
    );
  }, [data, isMobile]);

  return isLoading ? (
    <SkeletonList />
  ) : (
    <SessionList dataSource={filteredData} showAddButton={false} />
  );
});

SearchMode.displayName = 'SessionSearchMode';

export default SearchMode;
