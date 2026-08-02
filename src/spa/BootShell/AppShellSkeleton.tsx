'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import { isDesktop } from '@/const/version';
import {
  getInnerCssVariables,
  getOuterCssVariables,
} from '@/features/DesktopLayoutContainer/cssVariables';
import { styles as containerStyles } from '@/features/DesktopLayoutContainer/style';

import { readBootShellGeometry } from './geometry';

// antd emits its design tokens as `.lobe-vars{--ant-*: …}` — a plain global
// class rule, not a `:root` one. The shell renders outside `AppTheme`, so it has
// to opt into that class itself or every `var(--ant-*)` below resolves to its
// fallback.
const CSS_VAR_CLASS = 'lobe-vars';

export const APP_SHELL_FALLBACK_ID = 'app-shell-fallback';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    pointer-events: none;

    position: fixed;
    z-index: 99999;
    inset: 0;

    display: flex;
    flex-direction: column;
  `,
}));

interface AppShellSkeletonProps {
  id?: string;
}

const AppShellSkeleton = memo<AppShellSkeletonProps>(({ id }) => {
  const { isDark, navPanelBackground, navPanelWidth, showLeftPanel } = readBootShellGeometry();

  return (
    <div aria-hidden className={`${CSS_VAR_CLASS} ${styles.root}`} id={id}>
      {isDesktop && <div style={{ flexShrink: 0, height: TITLE_BAR_HEIGHT }} />}
      <Flexbox
        horizontal
        height={isDesktop ? `calc(100% - ${TITLE_BAR_HEIGHT}px)` : '100%'}
        width={'100%'}
      >
        {showLeftPanel && (
          <div
            style={{
              background: navPanelBackground,
              flexShrink: 0,
              height: '100%',
              width: navPanelWidth,
            }}
          />
        )}
        <Flexbox
          className={containerStyles.outerContainer}
          height={'100%'}
          padding={8}
          style={getOuterCssVariables({ expand: showLeftPanel })}
          width={'100%'}
        >
          <Flexbox
            className={containerStyles.innerContainer}
            height={'100%'}
            style={getInnerCssVariables({ isDark })}
            width={'100%'}
          />
        </Flexbox>
      </Flexbox>
    </div>
  );
});

AppShellSkeleton.displayName = 'AppShellSkeleton';

export default AppShellSkeleton;
