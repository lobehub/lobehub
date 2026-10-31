import type { ChannelListItem } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  AccordionRoot,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  copyToClipboard,
  cx,
  DropdownMenu,
  Flexbox,
  Text,
  toast,
} from '@lobehub/ui';
import {
  Archive,
  ArchiveRestore,
  Copy,
  GitBranch,
  Hash,
  MoreHorizontal,
  PencilLine,
  Plus,
  Trash,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { openRenameModal } from '@/components/RenameModal';
import EmptyNavItem from '@/features/NavPanel/components/EmptyNavItem';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { channelsInScope } from './channelScope';
import { openCreateChannel } from './CreateChannel';
import { channelPath, matchChannel } from './paths';
import { threadTitle } from './threadTitle';
import { useChannelArchive } from './useChannelArchive';
import { useChannelEvents } from './useChannelEvents';
import { useRemoveChannel } from './useRemoveChannel';
import { useThreadMenu } from './useThreadMenu';

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
  if (!detail?.threads.length) return null;

  return (
    <Flexbox aria-label={t('thread')} gap={1} paddingBlock={1} style={{ paddingInlineStart: 20 }}>
      {detail.threads.map((thread, index) => {
        const path = channelPath(channelId, thread.id, projectId);
        const active = thread.id === threadId;
        // Archived threads stay reachable from their root message, out of the sidebar.
        if (thread.status === 'archived' && !active) return null;
        const items = threadMenu(detail.channel, thread);
        return (
          <NavItem
            active={active}
            aria-current={active ? 'page' : undefined}
            contextMenuItems={items.length ? () => items : undefined}
            href={buildWorkspaceAwarePath(path, slug)}
            icon={GitBranch}
            iconSize={14}
            key={thread.id}
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
              threadTitle(detail.messages.find((message) => message.id === thread.rootMessageId)) ||
              `${t('thread')} ${index + 1}`
            }
            onClick={() => navigate(path)}
          />
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

  const remove = useRemoveChannel();
  const { archive, unarchive } = useChannelArchive();
  const [showArchived, setShowArchived] = useState(false);
  const activeChannelId = matchChannel(pathname);
  const create = () =>
    openCreateChannel((id) => navigate(channelPath(id, null, projectId)), projectId);
  const activeThreadId = new URLSearchParams(search).get('thread');
  const rename = (channel: ChannelListItem) =>
    openRenameModal({
      defaultValue: channel.title,
      maxLength: CHANNEL_LIMITS.titleLength,
      title: t('rename'),
      onSave: async (title) => {
        try {
          await channelActions.rename(channel.id, title);
        } catch (error) {
          console.error('Failed to rename Channel', error);
          toast.error(t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'renameForbidden' : 'renameFailed'));
          throw error; // Keep the dialog open with the typed name.
        }
      },
    });
  const menuItems = (channel: ChannelListItem) => [
    ...(channel.canDelete && channel.status !== 'archived'
      ? [{ icon: PencilLine, key: 'rename', label: t('rename'), onClick: () => rename(channel) }]
      : []),
    {
      icon: Copy,
      key: 'copyId',
      label: t('copyId'),
      onClick: async () => {
        try {
          await copyToClipboard(channel.id);
          toast.success(t('copyIdSuccess'));
        } catch (error) {
          console.error('Failed to copy Channel id', error);
          toast.error(t('actionFailed'));
        }
      },
    },
    ...(channel.canDelete
      ? [
          channel.status === 'archived'
            ? {
                icon: ArchiveRestore,
                key: 'unarchive',
                label: t('unarchive'),
                onClick: () => void unarchive(channel.id),
              }
            : {
                icon: Archive,
                key: 'archive',
                label: t('archive'),
                onClick: () => archive(channel),
              },
          { type: 'divider' as const },
          {
            danger: true,
            icon: Trash,
            key: 'delete',
            label: t('moveToTrash'),
            onClick: () => remove(channel),
          },
        ]
      : []),
  ];

  const renderChannel = (channel: ChannelListItem) => {
    const path = channelPath(channel.id, null, channel.projectId);
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

// Before the per-user flags load the store holds defaults; wait instead of guessing.
const useChannelsEnabled = () =>
  useServerConfigStore((s) => s.serverConfigInit && serverConfigSelectors.enableChannels(s));

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
