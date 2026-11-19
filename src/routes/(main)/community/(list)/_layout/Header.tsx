'use client';

import { cssVar } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useLocation } from 'react-router';

import NavHeader from '@/features/NavHeader';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';

import SortButton from '../features/SortButton';
import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const isHome = location.pathname === '/';
  const hasCatalogSearch = /\/community\/(?:skill|mcp)\/?$/.test(location.pathname);

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <NavHeader
      className={stylex.props(styles.headerContainer).className}
      left={hasCatalogSearch ? null : <StoreSearchBar />}
      style={cssVariables}
      right={
        !isHome && (
          <>
            {!hasCatalogSearch && <SortButton />}
            <UserAvatar />
          </>
        )
      }
      styles={{
        left: { flex: 1 },
      }}
    />
  );
});

export default Header;
