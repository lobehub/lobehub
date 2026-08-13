'use client';

import type { PropsWithChildren } from 'react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { SkeletonItem } from '@/features/NavPanel/components/SkeletonList';
import { SidebarHeaderSelectTrigger } from '@/features/NavPanel/SidebarHeaderSelect';
import { useAgentStore } from '@/store/agent';
import {
  agentProjectionSelectors,
  useCurrentAgentConfigStatus,
  useCurrentAgentValue,
} from '@/store/agent/projection';
import { builtinAgentSelectors } from '@/store/agent/selectors';

import SwitchPanel from './SwitchPanel';

const Agent = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['chat', 'common']);

  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const isInbox = activeAgentId === inboxAgentId;
  const { isLoading } = useCurrentAgentConfigStatus();
  const title = useCurrentAgentValue(agentProjectionSelectors.displayName);
  const avatar = useCurrentAgentValue(agentProjectionSelectors.avatar);
  const backgroundColor = useCurrentAgentValue((agent) => agent?.backgroundColor);

  const displayTitle = isInbox
    ? title || 'Lobe AI'
    : title || t('defaultSession', { ns: 'common' });

  if (isLoading) return <SkeletonItem height={32} padding={0} />;

  return (
    <SwitchPanel>
      <SidebarHeaderSelectTrigger
        avatar={isInbox ? avatar || DEFAULT_INBOX_AVATAR : avatar || DEFAULT_AVATAR}
        background={backgroundColor || undefined}
        title={displayTitle}
      />
    </SwitchPanel>
  );
});

export default Agent;
