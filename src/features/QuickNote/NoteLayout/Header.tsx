'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { quickNoteSelectors, UNCATEGORIZED_KEY, useQuickNoteStore } from '@/store/quickNote';

import FilterChips from './FilterChips';
import NewNoteButton from './NewNoteButton';

const Header = memo(() => {
  const { t } = useTranslation('note');
  const { t: tCommon } = useTranslation('common');
  const [activeCollection, activeTag, searchKeywords, setSearchKeywords] = useQuickNoteStore(
    (s) => [s.activeCollection, s.activeTag, s.searchKeywords, s.setSearchKeywords],
  );
  const filteredCount = useQuickNoteStore(quickNoteSelectors.filteredNotes).length;
  const [searchOpen, setSearchOpen] = useState(Boolean(searchKeywords));

  const scopeTitle =
    activeTag ??
    (activeCollection === UNCATEGORIZED_KEY
      ? t('sidebar.uncategorized')
      : (activeCollection ?? t('sidebar.allNotes')));

  return (
    <>
      <SideBarHeaderLayout breadcrumb={[{ href: '/note', title: tCommon('tab.note') }]} />
      <Flexbox
        horizontal
        align={'center'}
        height={32}
        justify={'space-between'}
        paddingInline={'12px 8px'}
      >
        <Flexbox horizontal align={'baseline'} gap={6} style={{ overflow: 'hidden' }}>
          <Text ellipsis weight={500}>
            {scopeTitle}
          </Text>
          <Text color={cssVar.colorTextTertiary} fontSize={12}>
            {t('list.count', { count: filteredCount })}
          </Text>
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={2}>
          <ActionIcon
            icon={SearchIcon}
            size={'small'}
            title={t('list.searchPlaceholder')}
            onClick={() =>
              setSearchOpen((open) => {
                if (open) setSearchKeywords('');
                return !open;
              })
            }
          />
          <NewNoteButton />
        </Flexbox>
      </Flexbox>
      {searchOpen && (
        <Flexbox paddingBlock={4} paddingInline={8}>
          <SearchBar
            allowClear
            autoFocus
            placeholder={t('list.searchPlaceholder')}
            value={searchKeywords}
            onInputChange={(value) => {
              setSearchKeywords(value);
              if (value === '') setSearchOpen(false);
            }}
          />
        </Flexbox>
      )}
      <FilterChips />
    </>
  );
});

Header.displayName = 'QuickNoteSidebarHeader';

export default Header;
