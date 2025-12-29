'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { Outlet } from 'react-router-dom';

import Footer from '@/features/Setting/Footer';
import WideScreenContainer from '@/features/WideScreenContainer';

import { MAX_WIDTH, SCROLL_PARENT_ID } from '../../features/const';
import Header from './Header';
import { styles } from './style';

/**
 * Desktop Discover Detail Layout
 * Layout for detail pages (assistant, model, provider, mcp details)
 */
const DesktopDiscoverDetailLayout = memo(() => {
  return (
    <>
      <Header />
      <Flexbox
        className={styles.mainContainer}
        height={'100%'}
        id={SCROLL_PARENT_ID}
        width={'100%'}
      >
        <WideScreenContainer
          className={styles.contentContainer}
          gap={32}
          minWidth={MAX_WIDTH}
          paddingBlock={16}
          wrapperStyle={{
            minHeight: '100%',
            position: 'relative',
          }}
        >
          <Outlet />
          <div className={styles.spacer} />
          <Footer />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

DesktopDiscoverDetailLayout.displayName = 'DesktopDiscoverDetailLayout';

export default DesktopDiscoverDetailLayout;
