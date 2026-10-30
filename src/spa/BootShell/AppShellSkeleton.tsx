'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { createStaticStyles, Flexbox, keyframes } from '@lobehub/ui';
import { LobeHub } from '@lobehub/ui/brand';
import { memo, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { retainSkeleton } from '@/components/Skeleton/skeletonHandover';
import { isDesktop } from '@/const/version';
import {
  getInnerCssVariables,
  getOuterCssVariables,
} from '@/features/DesktopLayoutContainer/cssVariables';
import { styles as containerStyles } from '@/features/DesktopLayoutContainer/style';
import { electronStylish } from '@/styles/electron';

import { readBootShellGeometry } from './geometry';
import { useLoadingHint } from './useLoadingHint';

// antd emits its design tokens as `.lobe-vars{--ant-*: …}` — a plain global
// class rule, not a `:root` one. The shell renders outside `AppTheme`, so it has
// to opt into that class itself or every `var(--lobe-*)` below resolves to its
// fallback.
const CSS_VAR_CLASS = 'lobe-vars';

export const APP_SHELL_FALLBACK_ID = 'app-shell-fallback';

// Opacity only: on an otherwise still boot screen a rising caption reads as
// the layout jumping, and leaving `transform` alone keeps the centering in one
// place.
const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
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
  // Floated rather than stacked in flow: a caption that joins the column would
  // push the brand mark off the center it shares with the app that replaces it.
  hint: css`
    position: absolute;
    inset-block-start: calc(100% + 8px);
    inset-inline-start: 50%;
    transform: translateX(-50%);

    font-size: 13px;
    white-space: nowrap;

    &[data-enter] {
      animation: ${fadeIn} 0.3s ${cssVar.motionEaseOut} both;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }
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

    /* Dialogs live inside the theme's isolated stacking context, so lowering
       this z-index alone cannot reveal them. Yield without releasing the boot gate. */
    body:has([role='dialog'][data-open]) & {
      visibility: hidden;
    }
  `,
}));

/**
 * Split out so `useTranslation` runs only once the hint is due. The boot shell
 * is a sibling of `RouterProvider` and renders before the tree that initializes
 * i18n, so calling it up front would hit react-i18next with no instance —
 * a console warning and a first render that echoes the raw key.
 */
const LoadingHint = memo<{ enter: boolean }>(({ enter }) => {
  const { t } = useTranslation('common');

  return (
    <div className={styles.hint} data-enter={enter || undefined}>
      {t('bootLoadingHint')}
    </div>
  );
});

LoadingHint.displayName = 'AppShellLoadingHint';

interface AppShellSkeletonProps {
  id?: string;
}

const AppShellSkeleton = memo<AppShellSkeletonProps>(({ id }) => {
  const { isDark, navPanelBackground, navPanelWidth, showLeftPanel } = readBootShellGeometry();
  const hint = useLoadingHint();

  useLayoutEffect(retainSkeleton, []);

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
                <LobeHub size={40} type={'text'} />
                {hint && <LoadingHint enter={hint === 'enter'} />}
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
