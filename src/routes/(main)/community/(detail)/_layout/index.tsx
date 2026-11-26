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
          gap={16}
          minWidth={MAX_WIDTH}
          style={{ paddingBottom: 56, paddingTop: 16 }}
          wrapperStyle={{
            minHeight: '100%',
            position: 'relative',
          }}
        >
          {/* Same column and spacing as the list layout, so a page opens where its catalog sat. */}
          <Flexbox gap={16} style={{ paddingBlockEnd: 40 }} width={'100%'}>
            <RouteSkeletonChromeProvider>
              <Outlet />
            </RouteSkeletonChromeProvider>
          </Flexbox>
          <div {...stylex.props(styles.spacer)} />
          <Footer />
        </WideScreenContainer>
      </Flexbox>
    </>
  );
});

DesktopDiscoverDetailLayout.displayName = 'DesktopDiscoverDetailLayout';

export default DesktopDiscoverDetailLayout;
