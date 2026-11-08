'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import { memo, useState } from 'react';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
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

const Header = memo(() => {
  const [showSearch, setShowSearch] = useState(false);

  return (
    <ChatHeader
      left={<Nav />}
      styles={{ center: { display: 'none' } }}
      center={
        showSearch && (
          <Flexbox
            align={'center'}
            className={stylex.props(styles.search).className}
            paddingBlock={8}
            paddingInline={16}
          >
            <StoreSearchBar mobile onBlur={() => setShowSearch(false)} />
          </Flexbox>
        )
      }
      right={
        showSearch ? (
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
            icon={SearchIcon}
            size={MOBILE_HEADER_ICON_SIZE}
            onClick={() => setShowSearch(true)}
          />
        )
      }
      style={{
        ...mobileHeaderSticky,
        overflow: 'unset',
      }}
    />
  );
});

export default Header;
