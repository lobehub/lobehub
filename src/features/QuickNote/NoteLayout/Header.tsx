'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import { useQuickNoteStore } from '@/store/quickNote';

import NewNoteButton from './NewNoteButton';

const Header = memo(() => {
  const { t } = useTranslation('common');
  const { t: tNote } = useTranslation('note');
  const [searchKeywords, setSearchKeywords] = useQuickNoteStore((s) => [
    s.searchKeywords,
    s.setSearchKeywords,
  ]);

  return (
    <>
      <SideBarHeaderLayout
        right={<NewNoteButton />}
        breadcrumb={[
          {
            href: '/note',
            title: t('tab.note'),
          },
        ]}
      />
      <Flexbox paddingBlock={4} paddingInline={8}>
        <SearchBar
          allowClear
          placeholder={tNote('list.searchPlaceholder')}
          value={searchKeywords}
          onInputChange={setSearchKeywords}
        />
      </Flexbox>
    </>
  );
});

Header.displayName = 'QuickNoteSidebarHeader';

export default Header;
