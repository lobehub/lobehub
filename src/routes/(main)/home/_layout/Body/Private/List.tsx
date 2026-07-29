'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { MoreHorizontal } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

import CreateAgentButton from '../Agent/CreateAgentButton';
import Group from '../Agent/List/Group';
import SessionList from '../Agent/List/List';
import { useKeepSidebarListed } from '../Agent/List/useAgentList';

interface PrivateListProps {
  hideCreateButton?: boolean;
  onMoreClick?: () => void;
}

// Renders only the workspace-private bucket: pinned private items, then
// private folders, then ungrouped agents/chat groups. The server already filters out
// items the viewer can't see (other members' private rows), so this list
// is always the viewer's own.
const PrivateList = memo<PrivateListProps>(({ hideCreateButton, onMoreClick }) => {
  const { t } = useTranslation('chat');
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const rawPrivatePinned = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const rawPrivateGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privateAgentPageSize = useGlobalStore(systemStatusSelectors.privateAgentPageSize);
  const rawPrivateUngrouped = useHomeStore(homeAgentListSelectors.privateUngroupedAgents, isEqual);
  const navigate = useWorkspaceAwareNavigate();
  const keep = useKeepSidebarListed();

  if (!isInit) return <SkeletonList rows={2} />;

  // Drop the caller's sidebar-hidden items BEFORE the page-size cut so a
  // removal doesn't shrink the visible page below `privateAgentPageSize`.
  const privatePinned = keep(rawPrivatePinned);
  const privateGroups = rawPrivateGroups.map((group) => ({ ...group, items: keep(group.items) }));
  const filteredUngrouped = keep(rawPrivateUngrouped);
  const privateUngrouped = filteredUngrouped.slice(0, privateAgentPageSize);

  const hasPinned = privatePinned.length > 0;
  const hasGroups = privateGroups.length > 0;
  const hasUngrouped = privateUngrouped.length > 0;
  const hasMore = filteredUngrouped.length > privateAgentPageSize;
  // The shared AllAgentsDrawer lists the workspace bucket, so the private
  // overflow routes to the private view-all tab instead; compact reusers
  // (e.g. the agent-detail switcher) pass their own navigation handler.
  const handleMoreClick = onMoreClick ?? (() => navigate('/agents?tab=private'));

  // Empty state still surfaces the create-button so a fresh user has an
  // obvious affordance for their first private agent.
  if (!hasPinned && !hasGroups && !hasUngrouped) {
    if (hideCreateButton) return null;
    return (
      <Flexbox gap={1} paddingBlock={1}>
        <CreateAgentButton visibility={'private'} />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={1} paddingBlock={1}>
      {hasPinned && <SessionList dataSource={privatePinned} />}
      {hasGroups && <Group dataSource={privateGroups} />}
      {hasUngrouped && <SessionList dataSource={privateUngrouped} />}
      {hasMore && (
        <NavItem icon={MoreHorizontal} title={t('input.more')} onClick={handleMoreClick} />
      )}
      {!hideCreateButton && <CreateAgentButton visibility={'private'} />}
    </Flexbox>
  );
});

PrivateList.displayName = 'PrivateList';

export default PrivateList;
