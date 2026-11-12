import { CHANNEL_URL } from '@lobechat/const';
import type { ChannelListItem } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  cx,
  type DropdownItem,
  DropdownMenu,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Archive, ArrowDownUp, Hash, MoreHorizontal, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { useGlobalStore } from '@/store/global';
import type { ChannelListSort } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';

import { channelsInScope } from './channelScope';
import { openCreateChannel } from './CreateChannel';
import { matchChannel } from './paths';
import { sortChannels } from './sortChannels';
import { threadTitle } from './threadTitle';
import { useChannelEvents } from './useChannelEvents';
import { useChannelMenu } from './useChannelMenu';
import { useChannelsEnabled } from './useChannelsEnabled';
import { useThreadMenu } from './useThreadMenu';

// The connector runs down from the centre of the Channel's icon (4px row padding + half
// its 28px slot) and bends into each thread row, the way Discord nests threads. A 2px line
// centres on that axis; Chromium floors fractional border widths, so 1.5px drew as 1px.
const SPINE_X = 17;

const SORT_BYS: ChannelListSort['by'][] = ['createdAt', 'updatedAt', 'title'];
const SORT_ORDERS: ChannelListSort['order'][] = ['desc', 'asc'];

const styles = stylex.create({
  thread: {
    position: 'relative',
    paddingInlineStart: 32,
  },
  // colorTextQuaternary is solid (unlike the fill tokens), so the elbow drawn over the spine never
  // shows a darker overlap; colorBorder vanished against the dark sidebar.
  spine: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlock: -1,
    insetInlineStart: SPINE_X,
    borderInlineStartColor: cssVar.colorTextQuaternary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 2,
  },
  elbow: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: -1,
    insetBlockEnd: '50%',
    insetInlineStart: SPINE_X,
    width: 11,
    borderBlockEndColor: cssVar.colorTextQuaternary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 2,
    borderInlineStartColor: cssVar.colorTextQuaternary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 2,
    borderEndStartRadius: 8,
  },
  // The first thread reaches up under the Channel's icon.
  firstElbow: { insetBlockStart: -8 },
  channel: { position: 'relative' },
  // An unread Channel gets a pill on the row's leading edge and a title one step brighter, the
  // way Discord marks it; an @mention adds a count badge. The accordion panel clips anything
  // outside the row, so the pill sits in the row's own inline padding.
  unreadPill: {
    pointerEvents: 'none',
    position: 'absolute',
    insetBlockStart: 14,
    insetInlineStart: 0,
    width: 4,
    height: 8,
    borderStartEndRadius: 4,
    borderEndEndRadius: 4,
    backgroundColor: cssVar.colorText,
  },
  mentionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
    height: 16,
    paddingInline: 4,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 1,
    color: '#fff',
    backgroundColor: cssVar.colorError,
    cursor: 'pointer',
  },
});

const ChannelThreads = ({
  channelId,
  projectId,
  threadId,
}: {
  channelId: string;
  projectId: string | null;
  threadId: string | null;
}) => {
  const { t } = useTranslation('channel');
  const navigate = useWorkspaceAwareNavigate();
  const slug = useActiveWorkspaceSlug();
  const threadMenu = useThreadMenu();
  // The open Channel's page already loads this view; the sidebar only reads it.
  const detail = useChannelStore(channelSelectors.detail({ channelId, threadId: null }));
  // Archived threads stay reachable from their root message, out of the sidebar.
  const shown = (detail?.threads ?? [])
    .map((thread, index) => ({ index, thread }))
    .filter(({ thread }) => thread.status !== 'archived' || thread.id === threadId);
  if (!detail || !shown.length) return null;

  return (
    <Flexbox aria-label={t('thread')} gap={1} paddingBlock={1}>
      {shown.map(({ thread, index }, position) => {
        const path = CHANNEL_URL(channelId, thread.id, projectId);
        const active = thread.id === threadId;
        const items = threadMenu(detail.channel, thread);
        return (
          <div key={thread.id} {...stylex.props(styles.thread)}>
            {position < shown.length - 1 && <span aria-hidden {...stylex.props(styles.spine)} />}
            <span
              aria-hidden
              {...stylex.props(styles.elbow, position === 0 && styles.firstElbow)}
            />
            <NavItem
              active={active}
              aria-current={active ? 'page' : undefined}
              contextMenuItems={items.length ? () => items : undefined}
              href={buildWorkspaceAwarePath(path, slug)}
              paddingInline={8}
              actions={
                items.length
                  ? () => (
                      <DropdownMenu items={items}>
                        <ActionIcon
                          icon={MoreHorizontal}
                          size="small"
                          title={t('more', { ns: 'common' })}
                        />
                      </DropdownMenu>
                    )
                  : undefined
              }
              title={
                threadTitle(
                  detail.messages.find((message) => message.id === thread.rootMessageId),
                  thread,
                ) || `${t('thread')} ${index + 1}`
              }
              onClick={() => navigate(path)}
            />
          </div>
        );
      })}
    </Flexbox>
  );
};

interface ChannelSectionProps {
  /** The accordion item value; the parent `AccordionRoot` owns the expanded state. */
  itemKey?: string;
  /**
   * Lists only this project's Channels, and new ones join it. Without it the list holds the
   * Channels outside any project.
   */
  projectId?: string;
}

/**
 * Channels beside Agents in the home sidebar or above a project's topics, with the open
 * Channel's threads nested under it.
 */
const EnabledChannelSection = ({ itemKey = 'channels', projectId }: ChannelSectionProps) => {
  const { t } = useTranslation('channel');
  const { pathname, search } = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();
  const slug = useActiveWorkspaceSlug();
  const sync = channelActions.useFetchList();
  const allChannels = useChannelStore(channelSelectors.list);
  const sort = useGlobalStore(systemStatusSelectors.channelListSort);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);
  const channels = useMemo(() => {
    const scoped = channelsInScope(allChannels, projectId);
    return scoped && sortChannels(scoped, sort);
  }, [allChannels, projectId, sort]);
  useChannelEvents();

  const [showArchived, setShowArchived] = useState(false);
  const activeChannelId = matchChannel(pathname);
  const create = () =>
    openCreateChannel((id) => navigate(CHANNEL_URL(id, null, projectId)), projectId);
  // Only a thread opened as the page is the current entry; one beside the Channel is not.
  const query = new URLSearchParams(search);
  const activeThreadId = query.get('view') === 'page' ? query.get('thread') : null;
  const menuItems = useChannelMenu();
  const setSort = (channelListSort: ChannelListSort) => updateSystemStatus({ channelListSort });
  // Name sorts read as A–Z / Z–A; time sorts as newest / oldest first.
  const orderLabelKey = sort.by === 'title' ? 'alpha' : 'time';
  const sortMenuItems: DropdownItem[] = [
    {
      children: SORT_BYS.map((by) => ({
        checked: sort.by === by,
        key: `sort-by-${by}`,
        label: t(`sort.by.${by}`),
        onCheckedChange: () => setSort({ ...sort, by }),
        type: 'checkbox' as const,
      })),
      key: 'sort-by',
      label: t('sort.by'),
      type: 'group' as const,
    },
    { type: 'divider' as const },
    {
      children: SORT_ORDERS.map((order) => ({
        checked: sort.order === order,
        key: `sort-order-${order}`,
        label: t(`sort.order.${orderLabelKey}.${order}`),
        onCheckedChange: () => setSort({ ...sort, order }),
        type: 'checkbox' as const,
      })),
      key: 'sort-order',
      label: t('sort.order'),
      type: 'group' as const,
    },
  ];

  const renderChannel = (channel: ChannelListItem) => {
    const path = CHANNEL_URL(channel.id, null, channel.projectId);
    const open = activeChannelId === channel.id;
    // The open Channel is being read; its count clears once the read receipt lands.
    const unread = !open && (channel.unreadCount ?? 0) > 0;
    const mentions = open ? 0 : (channel.mentionCount ?? 0);
    return (
      <Flexbox key={channel.id} {...stylex.props(styles.channel)}>
        {unread && <span aria-hidden {...stylex.props(styles.unreadPill)} />}
        <NavItem
          active={open && !activeThreadId}
          aria-current={open && !activeThreadId ? 'page' : undefined}
          contextMenuItems={() => menuItems(channel)}
          data-channel-id={channel.id}
          href={buildWorkspaceAwarePath(path, slug)}
          title={channel.title}
          titleColor={unread ? cssVar.colorText : undefined}
          actions={() => (
            <DropdownMenu items={menuItems(channel)}>
              <ActionIcon icon={MoreHorizontal} size="small" title={t('more', { ns: 'common' })} />
            </DropdownMenu>
          )}
          extra={
            mentions > 0 ? (
              <span
                aria-label={t('unreadMentions', { count: mentions })}
                {...stylex.props(styles.mentionBadge)}
                // NavItem stops clicks inside `extra`; the badge still opens the Channel.
                onClick={() => navigate(path)}
              >
                {mentions > 99 ? '99+' : mentions}
              </span>
            ) : undefined
          }
          onClick={() => navigate(path)}
          icon={Hash}
          // The glyph fills its whole box, so it reads larger than other nav icons at 18px.
          iconSize={14}
        />
        {open && (
          <ChannelThreads
            channelId={channel.id}
            projectId={channel.projectId}
            threadId={activeThreadId}
          />
        )}
      </Flexbox>
    );
  };
  // Archived channels leave the active list but stay one click away; an open one stays visible.
  const active = channels?.filter((channel) => channel.status !== 'archived') ?? [];
  const archived = channels?.filter((channel) => channel.status === 'archived') ?? [];
  const shownArchived = showArchived
    ? archived
    : archived.filter((channel) => channel.id === activeChannelId);

  return (
    <AccordionItem value={itemKey}>
      <AccordionHeader>
        <AccordionTrigger style={{ paddingBlock: 4, paddingInline: '8px 4px' }}>
          <Text ellipsis fontSize={12} type="secondary" weight={500}>
            {t('title')}
          </Text>
        </AccordionTrigger>
        <Flexbox
          horizontal
          align="center"
          gap={2}
          className={cx(
            'accordion-action',
            accordionStyles.action,
            accordionStyles.actionBorderless,
          )}
        >
          <DropdownMenu items={sortMenuItems} placement="bottomRight">
            <ActionIcon
              aria-label={t('sort.title')}
              icon={ArrowDownUp}
              size="small"
              title={t('sort.title')}
              onClick={(event) => event.stopPropagation()}
            />
          </DropdownMenu>
          <ActionIcon
            aria-label={t('create')}
            icon={Plus}
            size="small"
            title={t('create')}
            onClick={(event) => {
              event.stopPropagation();
              create();
            }}
          />
        </Flexbox>
      </AccordionHeader>
      <AccordionPanel contentStyle={{ padding: 0 }}>
        <Flexbox gap={1} paddingBlock={1}>
          {!channels && !sync.error && <SkeletonList rows={3} />}
          {!!sync.error && (
            <AsyncError
              error={sync.error}
              variant="inline"
              onRetry={() => void channelActions.refreshList()}
            />
          )}
          {channels && !active.length && <EmptyNavItem title={t('create')} onClick={create} />}
          {active.map(renderChannel)}
          {archived.length > 0 && (
            <>
              <NavItem
                aria-expanded={showArchived}
                icon={Archive}
                title={t('archivedGroup', { count: archived.length })}
                onClick={() => setShowArchived(!showArchived)}
              />
              {shownArchived.length > 0 && (
                <Flexbox gap={1} style={{ paddingInlineStart: 12 }}>
                  {shownArchived.map(renderChannel)}
                </Flexbox>
              )}
            </>
          )}
        </Flexbox>
      </AccordionPanel>
    </AccordionItem>
  );
};

/** One accordion item; place it inside an `AccordionRoot`. */
export const ChannelSection = (props: ChannelSectionProps) =>
  useChannelsEnabled() ? <EnabledChannelSection {...props} /> : null;

/** The home sidebar's standalone Channels, outside any project. */
const ChannelList = () =>
  useChannelsEnabled() ? (
    <AccordionRoot defaultValue={['channels']} indicatorPlacement="inline">
      <EnabledChannelSection />
    </AccordionRoot>
  ) : null;

export default ChannelList;
