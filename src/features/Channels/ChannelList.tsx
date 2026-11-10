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
  DropdownMenu,
  Flexbox,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Archive, Hash, MoreHorizontal, Plus } from 'lucide-react';
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

import { channelsInScope } from './channelScope';
import { openCreateChannel } from './CreateChannel';
import { matchChannel } from './paths';
import { threadTitle } from './threadTitle';
import { useChannelEvents } from './useChannelEvents';
import { useChannelMenu } from './useChannelMenu';
import { useChannelsEnabled } from './useChannelsEnabled';
import { useThreadMenu } from './useThreadMenu';

// The connector runs down from the centre of the Channel's icon (4px row padding + half
// its 28px slot) and bends into each thread row, the way Discord nests threads. A 2px line
// centres on that axis; Chromium floors fractional border widths, so 1.5px drew as 1px.
const SPINE_X = 17;

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
  const channels = useMemo(() => channelsInScope(allChannels, projectId), [allChannels, projectId]);
  useChannelEvents();

  const [showArchived, setShowArchived] = useState(false);
  const activeChannelId = matchChannel(pathname);
  const create = () =>
    openCreateChannel((id) => navigate(CHANNEL_URL(id, null, projectId)), projectId);
  const activeThreadId = new URLSearchParams(search).get('thread');
  const menuItems = useChannelMenu();

  const renderChannel = (channel: ChannelListItem) => {
    const path = CHANNEL_URL(channel.id, null, channel.projectId);
    const open = activeChannelId === channel.id;
    return (
      <Flexbox key={channel.id}>
        <NavItem
          active={open && !activeThreadId}
          aria-current={open && !activeThreadId ? 'page' : undefined}
          contextMenuItems={() => menuItems(channel)}
          data-channel-id={channel.id}
          href={buildWorkspaceAwarePath(path, slug)}
          icon={Hash}
          // The glyph fills its whole box, so it reads larger than other nav icons at 18px.
          iconSize={14}
          title={channel.title}
          actions={() => (
            <DropdownMenu items={menuItems(channel)}>
              <ActionIcon icon={MoreHorizontal} size="small" title={t('more', { ns: 'common' })} />
            </DropdownMenu>
          )}
          onClick={() => navigate(path)}
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
