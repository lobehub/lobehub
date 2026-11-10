'use client';

import { CHANNEL_URL } from '@lobechat/const';
import { ActionIcon, DropdownMenu, Flexbox, Icon, SearchBar, Text } from '@lobehub/ui';
import { HashIcon, PlusIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { openCreateChannel } from '@/features/Channels/CreateChannel';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import { useCreateMenuItems } from '@/features/HomeSidebar/hooks';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { useMessageSearch } from './SearchContext';

interface ListHeaderProps {
  actions?: ReactNode;
  title: string;
}

/** List column header: tab title on the left, column actions on the right. */
export const ListHeader = memo<ListHeaderProps>(({ title, actions }) => (
  <Flexbox
    horizontal
    align={'center'}
    gap={4}
    justify={'space-between'}
    paddingBlock={12}
    paddingInline={'14px 10px'}
  >
    <Text ellipsis fontSize={15} weight={600}>
      {title}
    </Text>
    <Flexbox horizontal align={'center'} gap={2}>
      {actions}
    </Flexbox>
  </Flexbox>
));

ListHeader.displayName = 'ListHeader';

const Header = memo(() => {
  const { t } = useTranslation(['common', 'channel']);
  const { query, setQuery } = useMessageSearch();
  const { createTopLevelMenuItems, isLoading } = useCreateMenuItems();
  const channelsEnabled = useChannelsEnabled();
  const navigate = useWorkspaceAwareNavigate();
  // Group Channels are rows of this list too, so they are created from the same entry.
  const createItems = useMemo(() => {
    const items = createTopLevelMenuItems();
    if (!channelsEnabled) return items;
    const [agent, group, ...rest] = items;
    return [
      agent,
      group,
      {
        icon: <Icon icon={HashIcon} />,
        key: 'newChannel',
        label: t('create', { ns: 'channel' }),
        onClick: () => openCreateChannel((id) => navigate(CHANNEL_URL(id))),
      },
      ...rest,
    ];
  }, [channelsEnabled, createTopLevelMenuItems, navigate, t]);

  // WeChat-style header: a search box that filters the list, and one "+" entry.
  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={6}
      paddingBlock={'12px 8px'}
      paddingInline={'10px 8px'}
    >
      <SearchBar
        allowClear
        placeholder={t('messageList.search')}
        size={'small'}
        style={{ flex: 1 }}
        value={query}
        variant={'filled'}
        onChange={(e) => setQuery(e.target.value)}
      />
      <DropdownMenu items={createItems}>
        <ActionIcon
          icon={PlusIcon}
          loading={isLoading}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('messageList.newChat')}
        />
      </DropdownMenu>
    </Flexbox>
  );
});

Header.displayName = 'MessageListHeader';

export default Header;
