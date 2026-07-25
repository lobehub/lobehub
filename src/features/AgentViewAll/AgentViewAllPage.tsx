'use client';

import { type SidebarAgentItem } from '@lobechat/types';
import { Center, Empty, Flexbox, Icon, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { Button, DropdownMenu, Segmented } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import { ChevronDownIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { AgentModalProvider } from '@/routes/(main)/home/_layout/Body/Agent/ModalProvider';
import { useCreateMenuItems } from '@/routes/(main)/home/_layout/hooks';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { workspaceUserSettingsSelectors } from '@/store/user/selectors';

import AgentCard, { cardStyles } from './AgentCard';
import AgentRow, { type AgentRowAuthor } from './AgentRow';
import { flattenAgentBuckets } from './flattenBuckets';
import ListConfig from './ListConfig';
import { type AgentListViewOptions, normalizeAgentListViewOptions } from './listViewOptions';
import TableHeader from './TableHeader';

type SegmentValue = 'private' | 'workspace';
type ViewMode = 'card' | 'list';

const AgentViewAllPage = memo(() => {
  const { t } = useTranslation('common');
  const activeWorkspaceId = useActiveWorkspaceId();
  // `?tab=private` lands the page on the Private tab, so each sidebar
  // section's "View all" arrow opens its own bucket. The URL is the single
  // source of truth — the page stays mounted across same-route navigations
  // (Workspace-arrow while on the Private tab), so local state would go stale.
  const [searchParams, setSearchParams] = useSearchParams();
  const segment: SegmentValue = searchParams.get('tab') === 'private' ? 'private' : 'workspace';
  const handleSegmentChange = useCallback(
    (value: SegmentValue) => {
      setSearchParams(value === 'private' ? { tab: 'private' } : {}, { replace: true });
    },
    [setSearchParams],
  );
  const [keyword, setKeyword] = useState('');

  // Card vs list rendering — persisted in systemStatus so the page reopens
  // in the last chosen mode (same mechanism as imageTopicViewMode & friends).
  const viewMode = useGlobalStore(systemStatusSelectors.agentListViewMode);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const handleViewModeChange = useCallback(
    (mode: ViewMode) => updateSystemStatus({ agentListViewMode: mode }),
    [updateSystemStatus],
  );

  // Grouping / ordering / hidden-agent visibility — persisted alongside the
  // view mode so the page keeps its display config (same as taskListViewOptions).
  const rawViewOptions = useGlobalStore(systemStatusSelectors.agentListViewOptions);
  const viewOptions = useMemo(
    () => normalizeAgentListViewOptions(rawViewOptions),
    [rawViewOptions],
  );
  const setViewOptions = useCallback(
    (updater: (prev: AgentListViewOptions) => AgentListViewOptions) => {
      const next = normalizeAgentListViewOptions(updater(viewOptions));
      updateSystemStatus({ agentListViewOptions: next }, 'updateAgentListViewOptions');
    },
    [updateSystemStatus, viewOptions],
  );

  // The sidebar usually owns these fetches, but this page must survive a
  // direct deep link — SWR dedupes when both are mounted.
  useFetchAgentList();
  const useFetchWorkspaceUserPreference = useUserStore((s) => s.useFetchWorkspaceUserPreference);
  useFetchWorkspaceUserPreference();

  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const pinnedAgents = useHomeStore(homeAgentListSelectors.pinnedAgents, isEqual);
  const agentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const ungroupedAgents = useHomeStore(homeAgentListSelectors.ungroupedAgents, isEqual);
  const privatePinnedAgents = useHomeStore(homeAgentListSelectors.privatePinnedAgents, isEqual);
  const privateAgentGroups = useHomeStore(homeAgentListSelectors.privateAgentGroups, isEqual);
  const privateUngroupedAgents = useHomeStore(
    homeAgentListSelectors.privateUngroupedAgents,
    isEqual,
  );

  // "In my sidebar" membership — workspace mode persists per-member in
  // workspace_user_settings; personal mode persists in users.preference.
  const sidebarHiddenAgentIds = useUserStore(
    (s) =>
      activeWorkspaceId
        ? workspaceUserSettingsSelectors.sidebarHiddenAgentIds(s)
        : (s.preference.sidebarHiddenAgentIds ?? []),
    isEqual,
  );
  const updateWorkspaceUserPreference = useUserStore((s) => s.updateWorkspaceUserPreference);
  const updatePreference = useUserStore((s) => s.updatePreference);

  const workspaceItems = useMemo(
    () => flattenAgentBuckets(pinnedAgents, agentGroups, ungroupedAgents),
    [pinnedAgents, agentGroups, ungroupedAgents],
  );
  const privateItems = useMemo(
    () => flattenAgentBuckets(privatePinnedAgents, privateAgentGroups, privateUngroupedAgents),
    [privatePinnedAgents, privateAgentGroups, privateUngroupedAgents],
  );

  const items = activeWorkspaceId && segment === 'private' ? privateItems : workspaceItems;

  // Author info (column, grouping, sorting) only means something on the
  // workspace tab — every private item is the viewer's own.
  const showAuthor = !!activeWorkspaceId && segment !== 'private';

  // Creator column: resolve each item's userId against the member roster.
  const members = useWorkspaceMembers();
  const authorByUserId = useMemo(() => {
    const map = new Map<string, AgentRowAuthor>();
    for (const member of members) {
      const profile = member.user;
      if (!profile) continue;
      map.set(member.userId, {
        avatar: profile.avatar,
        name: profile.fullName || profile.username || profile.email || undefined,
      });
    }
    return map;
  }, [members]);

  // A persisted author sort/grouping can outlive the tab that offers it
  // (picked on the workspace tab, then the user opens Private where the
  // author controls are hidden) — coerce back to visible defaults instead of
  // sorting by an invisible key with a select value that has no option.
  const { orderDirection, showSidebarHidden } = viewOptions;
  const groupBy = showAuthor ? viewOptions.groupBy : 'none';
  const orderBy =
    !showAuthor && viewOptions.orderBy === 'author' ? 'updatedAt' : viewOptions.orderBy;
  const effectiveViewOptions = useMemo(
    () => ({ ...viewOptions, groupBy, orderBy }),
    [viewOptions, groupBy, orderBy],
  );

  const filteredItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    let matched = query
      ? items.filter(
          (item) =>
            item.title?.toLowerCase().includes(query) ||
            item.description?.toLowerCase().includes(query),
        )
      : items;

    if (!showSidebarHidden) {
      matched = matched.filter((item) => !sidebarHiddenAgentIds.includes(item.id));
    }

    const authorName = (item: SidebarAgentItem) =>
      (item.userId && authorByUserId.get(item.userId)?.name) || '';

    const direction = orderDirection === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      if (orderBy === 'title') return direction * (a.title ?? '').localeCompare(b.title ?? '');
      if (orderBy === 'author') return direction * authorName(a).localeCompare(authorName(b));
      return direction * (dayjs(a.updatedAt).valueOf() - dayjs(b.updatedAt).valueOf());
    });
  }, [
    items,
    keyword,
    orderBy,
    orderDirection,
    showSidebarHidden,
    sidebarHiddenAgentIds,
    authorByUserId,
  ]);

  // Author sections (workspace tab only — every private item is the viewer's
  // own, so author buckets would be a single redundant group): items are
  // already sorted, so buckets keep the in-group order; groups themselves
  // read alphabetically.
  const groupedItems = useMemo(() => {
    if (!activeWorkspaceId || groupBy !== 'author' || segment === 'private') return null;
    const buckets = new Map<string, SidebarAgentItem[]>();
    for (const item of filteredItems) {
      const key = item.userId ?? '';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
    const groups = [...buckets.entries()].map(([userId, groupItems]) => ({
      items: groupItems,
      key: userId || 'unknown',
      label:
        (userId && authorByUserId.get(userId)?.name) || t('agentViewAll.groupBy.unknownAuthor'),
    }));
    return groups.sort((a, b) => a.label.localeCompare(b.label));
  }, [activeWorkspaceId, groupBy, segment, filteredItems, authorByUserId, t]);

  const handleToggleSidebar = useCallback(
    (item: SidebarAgentItem) => {
      const next = sidebarHiddenAgentIds.includes(item.id)
        ? sidebarHiddenAgentIds.filter((id) => id !== item.id)
        : [...sidebarHiddenAgentIds, item.id];
      if (activeWorkspaceId) {
        void updateWorkspaceUserPreference({ sidebarHiddenAgentIds: next });
      } else {
        void updatePreference({ sidebarHiddenAgentIds: next });
      }
    },
    [activeWorkspaceId, sidebarHiddenAgentIds, updatePreference, updateWorkspaceUserPreference],
  );

  const renderCard = useCallback(
    (item: SidebarAgentItem) => (
      <AgentCard
        author={item.userId ? authorByUserId.get(item.userId) : undefined}
        item={item}
        key={item.id}
        showAuthor={showAuthor}
        sidebarHidden={sidebarHiddenAgentIds.includes(item.id)}
        onToggleSidebar={handleToggleSidebar}
      />
    ),
    [showAuthor, authorByUserId, handleToggleSidebar, sidebarHiddenAgentIds],
  );

  const renderRow = useCallback(
    (item: SidebarAgentItem) => (
      <AgentRow
        author={item.userId ? authorByUserId.get(item.userId) : undefined}
        item={item}
        key={item.id}
        showAuthor={showAuthor}
        sidebarHidden={sidebarHiddenAgentIds.includes(item.id)}
        onToggleSidebar={handleToggleSidebar}
      />
    ),
    [showAuthor, authorByUserId, handleToggleSidebar, sidebarHiddenAgentIds],
  );

  const { allowed: canCreate, reason: createBlockedReason } = usePermission('create_content');
  const {
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    createPlatformAgentMenuItem,
    isMutatingAgent,
  } = useCreateMenuItems();

  // Creating from the Private tab lands the item in the private bucket, so
  // the new row appears in the list the user is currently looking at.
  const createOptions = useMemo(
    () =>
      activeWorkspaceId && segment === 'private' ? { visibility: 'private' as const } : undefined,
    [activeWorkspaceId, segment],
  );

  // Same menu as the sidebar's create button: agent / group chat / external
  // CLI agents / platform agent, all inheriting the segment's visibility.
  const createMenuItems = useMemo(() => {
    const heteroItems = createHeterogeneousAgentMenuItems(createOptions);
    const platformItem = createPlatformAgentMenuItem(createOptions);
    return [
      createAgentMenuItem(createOptions),
      createGroupChatMenuItem(createOptions),
      ...(heteroItems.length > 0 ? [{ type: 'divider' as const }, ...heteroItems] : []),
      ...(platformItem ? [{ type: 'divider' as const }, platformItem] : []),
    ];
  }, [
    createAgentMenuItem,
    createGroupChatMenuItem,
    createHeterogeneousAgentMenuItems,
    createPlatformAgentMenuItem,
    createOptions,
  ]);

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader
        left={
          <Text style={{ paddingInlineStart: 4 }} weight={500}>
            {t('agentViewAll.title')}
          </Text>
        }
        right={
          <ListConfig
            options={effectiveViewOptions}
            setOptions={setViewOptions}
            setViewMode={handleViewModeChange}
            showAuthor={showAuthor}
            viewMode={viewMode}
          />
        }
      />
      <WideScreenContainer gap={16} paddingBlock={16} wrapperStyle={{ flex: 1, overflowY: 'auto' }}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          {/* The workspace/private split only exists inside a workspace;
              personal mode leads with the search box instead. */}
          {activeWorkspaceId ? (
            <Segmented
              value={segment}
              options={[
                { label: t('navPanel.publicAgents'), value: 'workspace' },
                { label: t('navPanel.privateAgents'), value: 'private' },
              ]}
              onChange={(value) => handleSegmentChange(value as SegmentValue)}
            />
          ) : (
            <SearchBar
              allowClear
              placeholder={t('navPanel.searchAgent')}
              style={{ maxWidth: 240 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          )}
          <Flexbox horizontal align={'center'} gap={8}>
            {activeWorkspaceId && (
              <SearchBar
                allowClear
                placeholder={t('navPanel.searchAgent')}
                style={{ maxWidth: 240 }}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            )}
            {canCreate ? (
              <DropdownMenu items={createMenuItems}>
                <Button icon={PlusIcon} loading={isMutatingAgent}>
                  <Icon icon={ChevronDownIcon} size={14} />
                </Button>
              </DropdownMenu>
            ) : (
              <Tooltip title={createBlockedReason}>
                <Button disabled icon={PlusIcon}>
                  <Icon icon={ChevronDownIcon} size={14} />
                </Button>
              </Tooltip>
            )}
          </Flexbox>
        </Flexbox>
        {!isInit ? (
          <SkeletonList rows={8} />
        ) : filteredItems.length === 0 ? (
          <Center flex={1} padding={40}>
            <Empty
              description={
                keyword.trim() ? t('navPanel.searchResultEmpty') : t('agentViewAll.empty')
              }
            />
          </Center>
        ) : viewMode === 'card' ? (
          groupedItems ? (
            <Flexbox gap={24}>
              {groupedItems.map((group) => (
                <Flexbox gap={12} key={group.key}>
                  <Flexbox horizontal align={'center'} gap={6}>
                    <Text fontSize={13} weight={500}>
                      {group.label}
                    </Text>
                    <Text fontSize={12} type={'secondary'}>
                      {group.items.length}
                    </Text>
                  </Flexbox>
                  <div className={cardStyles.grid}>{group.items.map(renderCard)}</div>
                </Flexbox>
              ))}
            </Flexbox>
          ) : (
            <div className={cardStyles.grid}>{filteredItems.map(renderCard)}</div>
          )
        ) : (
          <Flexbox gap={2}>
            <TableHeader showAuthor={showAuthor} />
            {groupedItems
              ? groupedItems.map((group) => (
                  <Flexbox gap={2} key={group.key}>
                    <Flexbox
                      horizontal
                      align={'center'}
                      gap={6}
                      paddingBlock={8}
                      paddingInline={12}
                    >
                      <Text fontSize={13} weight={500}>
                        {group.label}
                      </Text>
                      <Text fontSize={12} type={'secondary'}>
                        {group.items.length}
                      </Text>
                    </Flexbox>
                    {group.items.map(renderRow)}
                  </Flexbox>
                ))
              : filteredItems.map(renderRow)}
          </Flexbox>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
});

AgentViewAllPage.displayName = 'AgentViewAllPage';

// The create menu prefers the wizard modal (`openCreateModal`) over blind
// blank-agent creation, and that modal lives in AgentModalContext — normally
// mounted by the Home layout, which this standalone route is NOT inside. Wrap
// the page so the "+" menu opens the same create wizard as the sidebar.
const AgentViewAllPageWithModals = memo(() => (
  <AgentModalProvider>
    <AgentViewAllPage />
  </AgentModalProvider>
));

AgentViewAllPageWithModals.displayName = 'AgentViewAllPageWithModals';

export default AgentViewAllPageWithModals;
