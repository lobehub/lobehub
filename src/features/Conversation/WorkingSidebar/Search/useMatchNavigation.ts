import { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * The match the user is on, and moving between matches. Jumping reuses the
 * conversation's message deep link (`#<messageId>`), which also pages in
 * history that is not loaded yet; `replace` keeps stepping through matches out
 * of the back stack.
 */
export const useMatchNavigation = (matchIds: string[]) => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [activeId, setActiveId] = useState<string>();
  const activeIndex = activeId ? matchIds.indexOf(activeId) : -1;

  const select = useCallback(
    (id: string) => {
      setActiveId(id);
      navigate({ hash: encodeURIComponent(id), pathname, search }, { replace: true });
    },
    [navigate, pathname, search],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (matchIds.length === 0) return;
      const from = activeIndex === -1 ? (delta === 1 ? -1 : 0) : activeIndex;
      select(matchIds[(from + delta + matchIds.length) % matchIds.length]);
    },
    [activeIndex, matchIds, select],
  );

  return { activeId: activeIndex === -1 ? undefined : activeId, activeIndex, select, step };
};
