'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';
import AddButton from '@/features/ResourceManager/components/Header/AddButton';

import LibraryHead from './LibraryHead';
import LibrarySearchBar from './LibrarySearchBar';
import { useActiveLibraryId } from './useActiveLibraryId';

const Header = memo(() => {
  const id = useActiveLibraryId();
  const { t } = useTranslation('common');
  return (
    <>
      <SideBarHeaderLayout
        backTo="/resource"
        left={<LibraryHead id={id} />}
        breadcrumb={[
          {
            href: `/resource/library/${id}`,
            title: t('tab.resource'),
          },
        ]}
      />
      {/*
        Search + create stay reachable from the sidebar no matter what the
        content area shows. The Explorer toolbar carries the same actions, but
        it is covered as soon as a page or file is opened, which left no way
        to add or find anything without backing out of the document first.
      */}
      <Flexbox horizontal align={'center'} gap={8} paddingBlock={'0 8px'} paddingInline={8}>
        <LibrarySearchBar />
        <AddButton iconOnly />
      </Flexbox>
    </>
  );
});

export default Header;
