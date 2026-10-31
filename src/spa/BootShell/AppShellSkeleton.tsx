'use client';

import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { Flexbox } from '@lobehub/ui';
import { LobeHub } from '@lobehub/ui/brand';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
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
import { sx } from '@/styles/sx';

import { readBootShellGeometry } from './geometry';
import { useLoadingHint } from './useLoadingHint';

// antd emits its design tokens as `.lobe-vars{--ant-*: …}` — a plain global
// class rule, not a `:root` one. The shell renders outside `AppTheme`, so it has
// to opt into that class itself or every `var(--lobe-*)` below resolves to its
// fallback.
const CSS_VAR_CLASS = 'lobe-vars';

export const APP_SHELL_FALLBACK_ID = 'app-shell-fallback';

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  contentBrand: {
    pointerEvents: 'none',
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: cssVar.colorTextQuaternary,
  },
  // Floated rather than stacked in flow: a caption that joins the column would
  // push the brand mark off the center it shares with the app that replaces it.
  hint: {
    position: 'absolute',
    insetBlockStart: 'calc(100% + 8px)',
    insetInlineStart: '50%',
    transform: 'translateX(-50%)',
    fontSize: '13px',
    whiteSpace: 'nowrap',
  },
  hintEnter: {
    animationName: { 'default': fadeIn, '@media (prefers-reduced-motion: reduce)': 'none' },
    animationDuration: { 'default': '0.3s', '@media (prefers-reduced-motion: reduce)': '0s' },
    animationTimingFunction: {
      'default': cssVar.motionEaseOut,
      '@media (prefers-reduced-motion: reduce)': 'ease',
    },
    animationFillMode: { 'default': 'both', '@media (prefers-reduced-motion: reduce)': 'none' },
  },
  brand: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragRegion: {
    pointerEvents: 'auto',
    flexShrink: 0,
    width: '100%',
  },
  root: {
    // The dialog and boot shell are siblings, not a marker/descendant pair.
    // A self condition preserves the existing body :has() rule without moving
    // the shell or introducing a component-scoped stylesheet.
    visibility: { 'default': null, ':is(body:has([role="dialog"][data-open]) *)': 'hidden' },
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: 99_999,
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
  },
});

/**
 * Split out so `useTranslation` runs only once the hint is due. The boot shell
 * is a sibling of `RouterProvider` and renders before the tree that initializes
 * i18n, so calling it up front would hit react-i18next with no instance —
 * a console warning and a first render that echoes the raw key.
 */
const LoadingHint = memo<{ enter: boolean }>(({ enter }) => {
  const { t } = useTranslation('common');

  return (
    <div {...stylex.props(styles.hint, enter && styles.hintEnter)} data-enter={enter || undefined}>
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
    <div aria-hidden id={id} {...sx(styles.root, CSS_VAR_CLASS)}>
      {isDesktop && (
        <div
          {...sx([styles.dragRegion], electronStylish.draggable, { height: TITLE_BAR_HEIGHT })}
        />
      )}
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
            <div {...stylex.props(styles.contentBrand)}>
              <div {...stylex.props(styles.brand)}>
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
