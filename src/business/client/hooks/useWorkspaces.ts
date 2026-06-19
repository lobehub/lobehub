import { useEffect } from 'react';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import type { WorkspaceListItem } from './useActiveWorkspace';
import {
  getWorkspaceSnapshot,
  hydrateActiveWorkspaceId,
  setActiveWorkspaceSnapshot,
} from './workspaceState';

export const WORKSPACE_LIST_KEY = 'business/workspaces';

export const useWorkspaceListSWR = () => {
  const isLoginWithAuth = useUserStore(authSelectors.isLoginWithAuth);

  return useSWR<WorkspaceListItem[]>(
    isLoginWithAuth ? WORKSPACE_LIST_KEY : null,
    () => lambdaClient.workspace.list.query(),
    {
      fallbackData: [],
      revalidateOnFocus: true,
    },
  );
};

export const useWorkspaces = (): WorkspaceListItem[] => {
  const { data = [] } = useWorkspaceListSWR();

  useEffect(() => {
    const activeId = getWorkspaceSnapshot().id ?? hydrateActiveWorkspaceId();
    if (!activeId) return;

    const active = data.find((workspace) => workspace.id === activeId);
    if (active) setActiveWorkspaceSnapshot({ id: active.id, slug: active.slug });
    else setActiveWorkspaceSnapshot({ id: null, slug: null });
  }, [data]);

  return data;
};
