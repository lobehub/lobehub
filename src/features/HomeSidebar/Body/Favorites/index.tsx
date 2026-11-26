'use client';

import {
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  accordionStyles,
  AccordionTrigger,
  ActionIcon,
  ContextMenuTrigger,
  cx,
  DropdownMenu,
} from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { useFetchFavorites } from '@/features/Favorites';
import SectionTitle, { useSectionTriggerStyle } from '@/features/NavPanel/components/SectionTitle';
import { useHomeStore } from '@/store/home';
import { favoriteSelectors } from '@/store/home/selectors';

import { useSidebarSectionMenuItems } from '../useSidebarSectionMenuItems';
import SortableFavoriteList from './SortableFavoriteList';

interface FavoritesProps {
  itemKey: string;
}

/**
 * Pages the member starred, in the order they arranged. The section only
 * appears once something is favorited: an empty one would be a heading with
 * nothing to act on, and the star on each page is the way in. A failed first
 * load still shows the section, with the error and a retry: the stars stay
 * disabled until the list is known, so the member needs a way back.
 */
const Favorites = memo<FavoritesProps>(({ itemKey }) => {
  const { t } = useTranslation('common');
  const sectionTriggerStyle = useSectionTriggerStyle();
  const { error, revalidate } = useFetchFavorites();
  const list = useHomeStore(favoriteSelectors.favoriteList);
  const loadFailed = list === undefined && !!error;
  const menuItems = useSidebarSectionMenuItems(itemKey);

  if (!loadFailed && (!list || list.length === 0)) return null;

  return (
    <AccordionItem value={itemKey}>
      <ContextMenuTrigger items={menuItems}>
        <AccordionHeader>
          <AccordionTrigger style={sectionTriggerStyle}>
            <SectionTitle>{t('favorite.section')}</SectionTitle>
          </AccordionTrigger>
          <div
            className={cx(
              'accordion-action',
              accordionStyles.action,
              accordionStyles.actionBorderless,
            )}
          >
            <DropdownMenu items={menuItems}>
              <ActionIcon
                aria-label={t('more')}
                icon={MoreHorizontalIcon}
                size={'small'}
                style={{ flex: 'none' }}
                title={t('more')}
              />
            </DropdownMenu>
          </div>
        </AccordionHeader>
      </ContextMenuTrigger>
      <AccordionPanel>
        {loadFailed ? (
          <AsyncError error={error} variant="inline" onRetry={() => revalidate()} />
        ) : (
          list && <SortableFavoriteList items={list} />
        )}
      </AccordionPanel>
    </AccordionItem>
  );
});

Favorites.displayName = 'Favorites';

export default Favorites;
