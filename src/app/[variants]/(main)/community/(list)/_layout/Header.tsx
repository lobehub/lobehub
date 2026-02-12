'use client';

import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useLocation } from 'react-router-dom';

import StoreSearchBar from '@/app/[variants]/(main)/community/features/Search';
import UserAvatar from '@/app/[variants]/(main)/community/features/UserAvatar';
import NavHeader from '@/features/NavHeader';

import SortButton from '../features/SortButton';
import { styles } from './Header/style';

const Header = memo(() => {
  const location = useLocation();
  const isHome = location.pathname === '/';

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
