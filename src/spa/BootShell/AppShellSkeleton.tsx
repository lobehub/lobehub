'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { LobeHub } from '@lobehub/ui/brand';
import { createStaticStyles, keyframes } from 'antd-style';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';
import {
  getInnerCssVariables,
  getOuterCssVariables,
} from '@/features/DesktopLayoutContainer/cssVariables';
import { styles as containerStyles } from '@/features/DesktopLayoutContainer/style';
import { electronStylish } from '@/styles/electron';

import { readBootShellGeometry } from './geometry';

// antd emits its design tokens as `.lobe-vars{--ant-*: …}` — a plain global
// class rule, not a `:root` one. The shell renders outside `AppTheme`, so it has
// to opt into that class itself or every `var(--ant-*)` below resolves to its
// fallback.
const CSS_VAR_CLASS = 'lobe-vars';

export const APP_SHELL_FALLBACK_ID = 'app-shell-fallback';

const HINT_DELAY = 1000;

// The X half of the transform is the centering, not the motion — it has to be
// restated in both frames or the keyframe overwrites it and the caption jumps
// to the anchor's left edge.
const slideUp = keyframes`
  from {
    opacity: 0;
    transform: translate(-50%, 10px);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  contentBrand: css`
    pointer-events: none;

    position: absolute;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    color: ${cssVar.colorTextQuaternary};
  `,
  // The mark carries the fade, not the whole stack: multiplying it into the
  // caption too leaves quaternary text at ~0.2 alpha, which is unreadable.
  mark: css`
    opacity: 0.48;
  `,
  // Floated rather than stacked in flow: a caption that joins the column would
  // push the brand mark off the center it shares with the app that replaces it.
  hint: css`
    position: absolute;
    inset-block-start: calc(100% + 8px);
    inset-inline-start: 50%;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;

    animation: ${slideUp} 0.42s ${cssVar.motionEaseOut} both;
  `,
  brand: css`
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  `,
  dragRegion: css`
    pointer-events: auto;
    flex-shrink: 0;
    width: 100%;
    height: ${TITLE_BAR_HEIGHT}px;
  `,
  root: css`
    pointer-events: none;

    position: fixed;
    z-index: 99999;
    inset: 0;

    display: flex;
    flex-direction: column;
  `,
}));

/**
 * Split out so `useTranslation` runs only once the hint is due. The boot shell
 * is a sibling of `RouterProvider` and renders before the tree that initializes
 * i18n, so calling it up front would hit react-i18next with no instance —
 * a console warning and a first render that echoes the raw key.
 */
const LoadingHint = memo(() => {
  const { t } = useTranslation('common');

  return <div className={styles.hint}>{t('stillLoading')}</div>;
});

LoadingHint.displayName = 'AppShellLoadingHint';

interface AppShellSkeletonProps {
  id?: string;
}

const AppShellSkeleton = memo<AppShellSkeletonProps>(({ id }) => {
  const { isDark, navPanelBackground, navPanelWidth, showLeftPanel } = readBootShellGeometry();
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaiting(true), HINT_DELAY);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div aria-hidden className={`${CSS_VAR_CLASS} ${styles.root}`} id={id}>
      {isDesktop && <div className={`${styles.dragRegion} ${electronStylish.draggable}`} />}
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
          >
            <div className={styles.contentBrand}>
              <div className={styles.brand}>
                <div className={styles.mark}>
                  <LobeHub size={40} type={'text'} />
                </div>
                {waiting && <LoadingHint />}
              </div>
            </div>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </div>
  );
});

AppShellSkeleton.displayName = 'AppShellSkeleton';

export default AppShellSkeleton;
