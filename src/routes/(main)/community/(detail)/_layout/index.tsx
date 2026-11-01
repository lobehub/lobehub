'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { Outlet } from 'react-router';

import Footer from '@/features/Setting/Footer';
import WideScreenContainer from '@/features/WideScreenContainer';
import { RouteSkeletonChromeProvider } from '@/spa/router/routeSkeletonChrome';

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
        className={stylex.props(styles.mainContainer).className}
        height={'100%'}
        id={SCROLL_PARENT_ID}
        width={'100%'}
      >
        <WideScreenContainer
          className={stylex.props(styles.contentContainer).className}
          gap={32}
          minWidth={MAX_WIDTH}
          paddingBlock={16}
          wrapperStyle={{
            minHeight: '100%',
            position: 'relative',
          }}
        >
          <RouteSkeletonChromeProvider>
            <Outlet />
          </RouteSkeletonChromeProvider>
          <div {...stylex.props(styles.spacer)} />
          <Footer />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

DesktopDiscoverDetailLayout.displayName = 'DesktopDiscoverDetailLayout';

export default DesktopDiscoverDetailLayout;
