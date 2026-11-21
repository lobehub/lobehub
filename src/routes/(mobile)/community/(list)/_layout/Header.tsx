'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { hasCatalogPageHeader } from '@/features/Marketplace/paths';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import StoreSearchBar from '../../../../(main)/community/features/Search';
import Nav from './Nav';

const styles = stylex.create({
  search: {
    position: 'absolute',
    zIndex: 10,
    insetBlockStart: '0',
    insetInline: '0',
    backgroundColor: cssVar.colorBgLayout,
    backgroundImage: 'none',
  },
});

const SearchAction = memo(() => {
  const { t } = useTranslation('common');
  const [showSearch, setShowSearch] = useState(false);

  return showSearch ? (
    <Flexbox
      align={'center'}
      className={stylex.props(styles.search).className}
      paddingBlock={8}
      paddingInline={16}
    >
      <StoreSearchBar mobile onBlur={() => setShowSearch(false)} />
    </Flexbox>
  ) : (
    <ActionIcon
      aria-label={t('tab.search')}
      icon={SearchIcon}
      size={MOBILE_HEADER_ICON_SIZE}
      onClick={() => setShowSearch(true)}
    />
  );
});

const Header = memo(() => {
  const { pathname } = useLocation();
  return (
    <ChatHeader
      left={<Nav />}
      right={!hasCatalogPageHeader(pathname) && <SearchAction />}
      styles={{ center: { display: 'none' } }}
      style={{
        ...mobileHeaderSticky,
        overflow: 'unset',
      }}
    />
  );
});

export default Header;
