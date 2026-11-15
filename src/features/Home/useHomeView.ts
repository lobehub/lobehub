import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { useWorkspaceMemberProfiles } from '@/business/client/hooks/useWorkspaceMemberProfiles';

export type HomeView = 'mine' | 'team';

const HOME_VIEW_PARAM = 'view';

/** Every workspace has a team view, even with one member; personal mode does not. */
export const resolveHomeView = (search: URLSearchParams, isWorkspace: boolean): HomeView =>
  isWorkspace && search.get(HOME_VIEW_PARAM) === 'team' ? 'team' : 'mine';

/**
 * The active Home tab lives in the URL so a refresh keeps it and a teammate can
 * be sent the board. Home stays mounted behind other routes; their URLs carry
 * no param, so the board unmounts and stops polling while Home is hidden.
 */
export const useHomeView = () => {
  // Personal mode (and OSS) has no member map at all.
  const isWorkspace = useWorkspaceMemberProfiles().size > 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const view = resolveHomeView(searchParams, isWorkspace);

  const setView = useCallback(
    (next: HomeView) => {
      setSearchParams(
        (previous) => {
          if (next === 'team') previous.set(HOME_VIEW_PARAM, 'team');
          else previous.delete(HOME_VIEW_PARAM);
          return previous;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { isWorkspace, setView, view };
};
