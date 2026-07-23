'use client';

import { type FC, memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import NotFound from '@/components/404';
import { agentGroupByIdSelectors, useAgentGroupStore } from '@/store/agentGroup';

/**
 * Terminal 404 card for a chat group whose detail fetch settled on nothing —
 * it doesn't exist or the viewer lost access (e.g. a workspace group switched
 * back to private by its owner).
 */
export const GroupNotFound = memo(() => {
  const { t } = useTranslation('chat');

  return <NotFound hideWatermark desc={t('groupNotFound.desc')} title={t('groupNotFound.title')} />;
});

GroupNotFound.displayName = 'GroupNotFound';

/**
 * Replaces children with the 404 card when the routed group (`:gid`) resolved
 * to not-found / no-access. The flag is cleared by any later successful fetch
 * (e.g. the group is made public again), so the guard recovers without a
 * manual refresh.
 */
export const GroupNotFoundGuard: FC<PropsWithChildren> = memo(({ children }) => {
  const params = useParams<{ gid?: string }>();
  const isNotFound = useAgentGroupStore(
    agentGroupByIdSelectors.isGroupNotFoundById(params.gid ?? ''),
  );

  if (isNotFound) return <GroupNotFound />;

  return children;
});

GroupNotFoundGuard.displayName = 'GroupNotFoundGuard';
