'use client';

import { ActionIcon, DropdownMenu, Flexbox, Text } from '@lobehub/ui';
import { SearchIcon, SquarePenIcon } from 'lucide-react';
import { memo, type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useCreateMenuItems } from '@/features/HomeSidebar/hooks';
import { useGlobalStore } from '@/store/global';

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
  const toggleCommandMenu = useGlobalStore((s) => s.toggleCommandMenu);
  const { createTopLevelMenuItems, isLoading } = useCreateMenuItems();
  const createItems = useMemo(() => createTopLevelMenuItems(), [createTopLevelMenuItems]);

  return (
    <ListHeader
      title={t('tab.messages')}
      actions={
        <>
          <ActionIcon
            icon={SearchIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('tab.search')}
            onClick={() => toggleCommandMenu(true)}
          />
          <DropdownMenu items={createItems}>
            <ActionIcon
              icon={SquarePenIcon}
              loading={isLoading}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('messageList.newChat')}
            />
          </DropdownMenu>
        </>
      }
    />
  );
});

Header.displayName = 'MessageListHeader';

export default Header;
