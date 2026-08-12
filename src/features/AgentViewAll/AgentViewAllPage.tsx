'use client';

import { DEFAULT_AVATAR } from '@lobechat/const';
import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import { Avatar, Center, Empty, Flexbox, Icon, SearchBar, Text, Tooltip } from '@lobehub/ui';
import { Button, DropdownMenu, Segmented, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useWorkspaceMembers } from '@/business/client/hooks/useWorkspaceMembers';
import { useKeepSidebarGroupsListed } from '@/features/HomeSidebar/Body/Agent/List/useAgentList';
import { AgentModalProvider } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { useSidebarItemVisibility } from '@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility';
import { useCreateMenuItems } from '@/features/HomeSidebar/hooks';
import NavHeader from '@/features/NavHeader';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useFetchAgentLabels } from '@/hooks/useFetchAgentLabels';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';

import AgentCard, { cardStyles } from './AgentCard';
import AgentRow, { type AgentRowAuthor } from './AgentRow';
import { flattenAgentBuckets } from './flattenBuckets';
import ListConfig from './ListConfig';
import { type AgentListViewOptions, normalizeAgentListViewOptions } from './listViewOptions';
import SidebarAgentsSection from './SidebarAgentsSection';

type SegmentValue = 'private' | 'workspace';
type ViewMode = 'card' | 'list';

interface GroupHeaderProps {
  /** Author avatar for author-grouping headers (Linear-style). */
  avatar?: string | null;
  collapsed: boolean;
  color?: string | null;
  count: number;
  /** Position in the group list — drives the alternating bar tint. */
  index: number;
  label: string;
  onToggle: () => void;
}

// Linear-style group header: a full-width subtle bar with chevron +
// identity (color dot / avatar) + name + count.
const groupHeaderStyles = createStaticStyles(({ css, cssVar }) => ({
  bar: css`
    cursor: pointer;
    user-select: none;

    width: 100%;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadiusLG};

    transition: background 0.15s;
  `,
  // Alternating tints (mirrors Linear's group striping).
  barEven: css`
    background: ${cssVar.colorFillQuaternary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  barOdd: css`
    background: ${cssVar.colorFillTertiary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
}));

const GroupHeader = memo<GroupHeaderProps>(
  ({ avatar, collapsed, color, count, index, label, onToggle }) => (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      className={cx(
        groupHeaderStyles.bar,
        index % 2 === 0 ? groupHeaderStyles.barEven : groupHeaderStyles.barOdd,
      )}
      onClick={onToggle}
    >
      <Icon
        color={cssVar.colorTextSecondary}
        icon={collapsed ? ChevronRightIcon : ChevronDownIcon}
        size={14}
      />
      {avatar ? (
        <Avatar avatar={avatar} size={20} />
      ) : color ? (
        <span
          style={{
            background: color,
            borderRadius: '50%',
            display: 'inline-block',
            height: 9,
            width: 9,
          }}
        />
      ) : null}
      <Text fontSize={13} weight={500}>
        {label}
      </Text>
      <Text fontSize={12} type={'secondary'}>
        {count}
      </Text>
    </Flexbox>
  ),
);

GroupHeader.displayName = 'AgentViewAllGroupHeader';

// Bucket tab label: name plus how many agents the tab would list, in the same
// muted-count style the group headers use.
const SegmentLabel = memo<{ count: number; label: string }>(({ count, label }) => (
  <Flexbox horizontal align={'center'} gap={6}>
    {label}
    <Text fontSize={12} type={'secondary'}>
      {count}
    </Text>
  </Flexbox>
));

SegmentLabel.displayName = 'AgentViewAllSegmentLabel';

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
  useFetchAgentLabels();
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

  const { isSidebarItemVisible, setSidebarItemVisible } = useSidebarItemVisibility();
  const keepGroups = useKeepSidebarGroupsListed();

  const workspaceItems = useMemo(
    () => flattenAgentBuckets(pinnedAgents, agentGroups, ungroupedAgents),
    [pinnedAgents, agentGroups, ungroupedAgents],
  );
  const privateItems = useMemo(
    () => flattenAgentBuckets(privatePinnedAgents, privateAgentGroups, privateUngroupedAgents),
    [privatePinnedAgents, privateAgentGroups, privateUngroupedAgents],
  );

  const items = activeWorkspaceId && segment === 'private' ? privateItems : workspaceItems;

  // "In sidebar" overview data: everything visible in the sidebar across BOTH
  // the workspace and private buckets — the block answers "what's in my
  // sidebar right now", so it ignores the tab and the search keyword (it
  // hides entirely while searching to keep results scannable).
  const sidebarItems = useMemo(() => {
    // Rebuilt from folder-filtered buckets rather than reusing the page's
    // flattened lists: hiding a Category removes its whole section from the
    // sidebar, so its agents are not "in sidebar" either. The page's own list
    // deliberately keeps showing them — hiding is a sidebar-only preference.
    const inSidebar = [
      ...flattenAgentBuckets(pinnedAgents, keepGroups(agentGroups), ungroupedAgents),
      ...flattenAgentBuckets(
        privatePinnedAgents,
        keepGroups(privateAgentGroups),
        privateUngroupedAgents,
      ),
    ];
    const seen = new Set<string>();
    return inSidebar.filter((item) => {
      if (seen.has(item.id) || !isSidebarItemVisible(item)) return false;
      seen.add(item.id);
      return true;
    });
  }, [
    agentGroups,
    isSidebarItemVisible,
    keepGroups,
    pinnedAgents,
    privateAgentGroups,
    privatePinnedAgents,
    privateUngroupedAgents,
    ungroupedAgents,
  ]);

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

  // Tab counts describe how big each bucket is, so they follow the persisted
  // hidden-agent setting (what the tab would list) but ignore the keyword —
  // searching narrows the list below, it doesn't shrink the buckets.
  const bucketCounts = useMemo(() => {
    const count = (list: SidebarAgentItem[]) =>
      showSidebarHidden ? list.length : list.filter(isSidebarItemVisible).length;
    return { private: count(privateItems), workspace: count(workspaceItems) };
  }, [workspaceItems, privateItems, showSidebarHidden, isSidebarItemVisible]);

  // Label grouping works on every tab (labels exist in personal mode too);
  // author grouping only makes sense where the author column shows.
  const groupBy =
    showAuthor || viewOptions.groupBy === 'label'
      ? viewOptions.groupBy
      : viewOptions.groupBy === 'author'
        ? 'none'
        : viewOptions.groupBy;
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
            item.name?.toLowerCase().includes(query) ||
            item.title?.toLowerCase().includes(query) ||
            item.description?.toLowerCase().includes(query),
        )
      : items;

    if (!showSidebarHidden) {
      matched = matched.filter(isSidebarItemVisible);
    }

    const authorName = (item: SidebarAgentItem) =>
      (item.userId && authorByUserId.get(item.userId)?.name) || '';

    const direction = orderDirection === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      // Sort on the label the rows actually render, not the raw title — otherwise
      // a list of personal names comes back ordered by their hidden roles.
      if (orderBy === 'title')
        return direction * agentDisplayName(a, '').localeCompare(agentDisplayName(b, ''));
      if (orderBy === 'author') return direction * authorName(a).localeCompare(authorName(b));
      return direction * (dayjs(a.updatedAt).valueOf() - dayjs(b.updatedAt).valueOf());
    });
  }, [
    items,
    keyword,
    orderBy,
    orderDirection,
    showSidebarHidden,
    isSidebarItemVisible,
    authorByUserId,
  ]);

  // Author sections (workspace tab only — every private item is the viewer's
  // own, so author buckets would be a single redundant group): items are
  // already sorted, so buckets keep the in-group order; groups themselves
  // read alphabetically.
  const groupedItems = useMemo(() => {
    if (groupBy === 'author') {
      if (!activeWorkspaceId || segment === 'private') return null;
      const buckets = new Map<string, SidebarAgentItem[]>();
      for (const item of filteredItems) {
        const key = item.userId ?? '';
        const bucket = buckets.get(key);
        if (bucket) bucket.push(item);
        else buckets.set(key, [item]);
      }
      const groups = [...buckets.entries()].map(([userId, groupItems]) => ({
        // Same fallback as the row avatars — a member without a profile
        // avatar still gets the default one instead of a bare name.
        avatar: (userId && authorByUserId.get(userId)?.avatar) || DEFAULT_AVATAR,
        color: undefined as string | null | undefined,
        items: groupItems,
        key: `author:${userId || 'unknown'}`,
        label:
          (userId && authorByUserId.get(userId)?.name) || t('agentViewAll.groupBy.unknownAuthor'),
      }));
      return groups.sort((a, b) => a.label.localeCompare(b.label));
    }

    if (groupBy === 'label') {
      // Label sections: an agent carrying several labels appears once per
      // label (mirrors Linear); unlabeled items collect in a trailing bucket.
      const buckets = new Map<
        string,
        { color?: string | null; items: SidebarAgentItem[]; label: string }
      >();
      const unlabeled: SidebarAgentItem[] = [];
      for (const item of filteredItems) {
        const itemLabels = item.labels ?? [];
        if (itemLabels.length === 0) {
          unlabeled.push(item);
          continue;
        }
        for (const label of itemLabels) {
          const bucket = buckets.get(label.id);
          if (bucket) bucket.items.push(item);
          else buckets.set(label.id, { color: label.color, items: [item], label: label.name });
        }
      }
      const groups = [...buckets.entries()]
        .map(([labelId, bucket]) => ({
          avatar: null as string | null,
          color: bucket.color,
          items: bucket.items,
          key: `label:${labelId}`,
          label: bucket.label,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      if (unlabeled.length > 0)
        groups.push({
          avatar: null,
          color: undefined,
          items: unlabeled,
          key: 'label:none',
          label: t('agentViewAll.groupBy.noLabel'),
        });
      return groups;
    }

    return null;
  }, [activeWorkspaceId, groupBy, segment, filteredItems, authorByUserId, t]);

  // Group collapse state — groups default to COLLAPSED (mirrors Linear), so
  // the EXPANDED keys are what persists (systemStatus): a reload keeps opened
  // groups open, and newly appearing groups start collapsed.
  const expandedGroupKeys = useGlobalStore(
    systemStatusSelectors.agentListExpandedGroupKeys,
    isEqual,
  );
  const expandedGroupSet = useMemo(() => new Set(expandedGroupKeys), [expandedGroupKeys]);
  const toggleGroupCollapsed = useCallback(
    (key: string) => {
      const next = expandedGroupSet.has(key)
        ? expandedGroupKeys.filter((item) => item !== key)
        : [...expandedGroupKeys, key];
      updateSystemStatus({ agentListExpandedGroupKeys: next }, 'toggleAgentListGroupExpanded');
    },
    [expandedGroupKeys, expandedGroupSet, updateSystemStatus],
  );

  const handleToggleSidebar = useCallback(
    async (item: SidebarAgentItem) => {
      try {
        await setSidebarItemVisible(item.id, !isSidebarItemVisible(item));
      } catch (error) {
        // Personal mode writes the preference optimistically and never rolls
        // back, workspace mode rolls back silently — either way the row's
        // state stops matching what was saved, so say so.
        console.error('Failed to toggle Agent sidebar visibility:', error);
        toast.error(t('operationFailed'));
      }
    },
    [isSidebarItemVisible, setSidebarItemVisible, t],
  );

  const renderCard = useCallback(
    (item: SidebarAgentItem) => (
      <AgentCard
        author={item.userId ? authorByUserId.get(item.userId) : undefined}
        item={item}
        key={item.id}
        showAuthor={showAuthor}
        sidebarHidden={!isSidebarItemVisible(item)}
        onToggleSidebar={handleToggleSidebar}
      />
    ),
    [showAuthor, authorByUserId, handleToggleSidebar, isSidebarItemVisible],
  );

  const renderRow = useCallback(
    (item: SidebarAgentItem) => (
      <AgentRow
        author={item.userId ? authorByUserId.get(item.userId) : undefined}
        item={item}
        key={item.id}
        showAuthor={showAuthor}
        sidebarHidden={!isSidebarItemVisible(item)}
        onToggleSidebar={handleToggleSidebar}
      />
    ),
    [showAuthor, authorByUserId, handleToggleSidebar, isSidebarItemVisible],
  );

  const { allowed: canCreate, reason: createBlockedReason } = usePermission('create_content');
  const {
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
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
  // CLI agents / platform agent, all inheriting the segment's visibility. The
  // sidebar's "add from Agent list" entry is omitted — it navigates to this
  // very page.
  const createMenuItems = useMemo(() => {
    const connectItem = createConnectAgentMenuItem(createOptions);
    return [
      createAgentMenuItem(createOptions),
      createGroupChatMenuItem(createOptions),
      ...(connectItem ? [{ type: 'divider' as const }, connectItem] : []),
      { type: 'divider' as const },
      createMarketAgentMenuItem(),
    ];
  }, [
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
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
        {isInit && !keyword.trim() && sidebarItems.length > 0 && (
          <SidebarAgentsSection items={sidebarItems} onToggleSidebar={handleToggleSidebar} />
        )}
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          {/* The workspace/private split only exists inside a workspace;
              personal mode leads with the search box instead. */}
          {activeWorkspaceId ? (
            <Segmented
              value={segment}
              options={[
                {
                  label: (
                    <SegmentLabel
                      count={bucketCounts.workspace}
                      label={t('navPanel.publicAgents')}
                    />
                  ),
                  value: 'workspace',
                },
                {
                  label: (
                    <SegmentLabel
                      count={bucketCounts.private}
                      label={t('navPanel.privateAgents')}
                    />
                  ),
                  value: 'private',
                },
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
            <Flexbox gap={8}>
              {groupedItems.map((group, index) => {
                const collapsed = !expandedGroupSet.has(group.key);
                return (
                  <Flexbox gap={12} key={group.key}>
                    <GroupHeader
                      avatar={group.avatar}
                      collapsed={collapsed}
                      color={group.color}
                      count={group.items.length}
                      index={index}
                      label={group.label}
                      onToggle={() => toggleGroupCollapsed(group.key)}
                    />
                    {!collapsed && (
                      <div className={cardStyles.grid}>{group.items.map(renderCard)}</div>
                    )}
                  </Flexbox>
                );
              })}
            </Flexbox>
          ) : (
            <div className={cardStyles.grid}>{filteredItems.map(renderCard)}</div>
          )
        ) : (
          // Grouped list shares the card branch's wrapper rhythm (outer gap 8,
          // bare GroupHeader) so toggling the view mode doesn't shift the bars.
          <Flexbox gap={groupedItems ? 8 : 2}>
            {groupedItems
              ? groupedItems.map((group, index) => {
                  const collapsed = !expandedGroupSet.has(group.key);
                  return (
                    <Flexbox gap={2} key={group.key}>
                      <GroupHeader
                        avatar={group.avatar}
                        collapsed={collapsed}
                        color={group.color}
                        count={group.items.length}
                        index={index}
                        label={group.label}
                        onToggle={() => toggleGroupCollapsed(group.key)}
                      />
                      {!collapsed && group.items.map(renderRow)}
                    </Flexbox>
                  );
                })
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
const AgentViewAllPageWithModals = () => (
  <AgentModalProvider>
    <AgentViewAllPage />
  </AgentModalProvider>
);

export default AgentViewAllPageWithModals;
