'use client';

import { ActionIcon, DropdownMenu, Flexbox, SearchBar, Text } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useCreateMenuItems } from '@/features/HomeSidebar/hooks';

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
  const { t } = useTranslation('common');
  const { query, setQuery } = useMessageSearch();
  const { createTopLevelMenuItems, isLoading } = useCreateMenuItems();
  const createItems = useMemo(() => createTopLevelMenuItems(), [createTopLevelMenuItems]);

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
