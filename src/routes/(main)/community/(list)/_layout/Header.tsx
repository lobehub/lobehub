'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import StoreSearchBar from '@/routes/(main)/community/features/Search';
import UserAvatar from '@/routes/(main)/community/features/UserAvatar';
import { routerSelectors, useRouterStore } from '@/store/router';

import SortButton from '../features/SortButton';
import { styles } from './Header/style';

const Header = memo(() => {
  const pathname = useRouterStore(routerSelectors.pathname);
  const isHome = pathname === '/';

  const cssVariables: Record<string, string> = {
    '--header-border-color': cssVar.colorBorderSecondary,
  };

  return (
    <NavHeader
      className={styles.headerContainer}
      left={<StoreSearchBar />}
      style={cssVariables}
      right={
        !isHome && (
          <>
            <SortButton />
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
