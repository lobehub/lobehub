'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import Group from '../Agent/List/Group';
import SessionList from '../Agent/List/List';
import CreatePrivateButton from './CreatePrivateButton';

// Renders only the workspace-private bucket: private folders followed by
// private ungrouped agents/chat groups. The server already filters out
// items the viewer can't see (other members' private rows), so this list
// is always the viewer's own.
const PrivateList = memo(() => {
  const { t } = useTranslation('chat');
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const privateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privateAgentPageSize = useGlobalStore(systemStatusSelectors.privateAgentPageSize);
  const privateUngrouped = useHomeStore(
    homeAgentListSelectors.privateUngroupedAgentsLimited(privateAgentPageSize),
    isEqual,
  );
  const privateUngroupedCount = useHomeStore(homeAgentListSelectors.privateUngroupedAgentsCount);
  const openAllAgentsDrawer = useHomeStore((s) => s.openAllAgentsDrawer);

  if (!isInit) return <SkeletonList rows={2} />;

  const hasGroups = privateGroups.length > 0;
  const hasUngrouped = privateUngrouped.length > 0;
  const hasMore = privateUngroupedCount > privateAgentPageSize;

  // Empty state still surfaces the create-button so a fresh user has an
  // obvious affordance for their first private agent.
  if (!hasGroups && !hasUngrouped) {
    return (
      <Flexbox gap={1} paddingBlock={1}>
        <CreatePrivateButton />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={1} paddingBlock={1}>
      {hasGroups && <Group dataSource={privateGroups} />}
      {hasUngrouped && <SessionList dataSource={privateUngrouped} />}
      {hasMore && (
        <NavItem icon={MoreHorizontal} title={t('input.more')} onClick={openAllAgentsDrawer} />
      )}
      <CreatePrivateButton />
    </Flexbox>
  );
});

PrivateList.displayName = 'PrivateList';

export default PrivateList;
