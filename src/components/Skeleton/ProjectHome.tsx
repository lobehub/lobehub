'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import SkeletonBar from './Bar';

/**
 * Mirrors the project home (`features/Projects/Workspace`): a vertically
 * centered intro column — title, subtitle, then the composer's context tray
 * tucked behind its rounded card. `RouteLoading` renders this for both the
 * chunk wait and the page's own data wait, so a project home keeps one shape
 * while it loads instead of showing the generic detail surface first.
 *
 * The onboarding checklist below the composer is left out on purpose: the card
 * only exists while a project still has onboarding steps open, so a placeholder
 * for it would be the next mismatch for every project that dismissed it.
 */

/** Same geometry as `ProjectComposer`: tray row, its visible padding, the overlap. */
const TRAY_ROW_HEIGHT = 32;
const TRAY_PADDING_BLOCK = 5;
const TRAY_OVERLAP = 18;

const styles = stylex.create({
  card: {
    position: 'relative',
    zIndex: 1,
    boxSizing: 'border-box',
    minHeight: '88px',
    marginBlockStart: `-${TRAY_OVERLAP}px`,
    padding: '12px',
    borderRadius: '18px',
    backgroundColor: cssVar.colorBgContainer,
    boxShadow: cssVar.boxShadowSecondary,
  },
  intro: {
    width: '100%',
    maxWidth: '760px',
    marginInline: 'auto',
  },
  // Same column as the loaded page: centered vertically, 1060px wide at most.
  page: {
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    width: {
      'default': 'min(1060px, calc(100% - 64px))',
      '@media (width <= 720px)': 'calc(100% - 40px)',
    },
    minHeight: '100%',
    marginInline: 'auto',
    paddingBlock: { 'default': '48px', '@media (width <= 720px)': '32px' },
  },
  tray: {
    paddingBlockStart: `${TRAY_PADDING_BLOCK}px`,
    paddingBlockEnd: `${TRAY_OVERLAP + TRAY_PADDING_BLOCK}px`,
    paddingInline: '10px',
    borderStartStartRadius: '20px',
    borderStartEndRadius: '20px',
    backgroundColor: cssVar.colorFillTertiary,
  },
  // Same frame as the composer's: the tray stops 24px short of the card on
  // each side, so its top corners always stay inside the card's silhouette.
  trayFrame: {
    paddingInline: '24px',
  },
});

const TraySkeleton = () => (
  <Flexbox
    horizontal
    align={'center'}
    className={stylex.props(styles.tray).className}
    justify={'space-between'}
  >
    <Flexbox horizontal align={'center'} gap={4} height={TRAY_ROW_HEIGHT}>
      <SkeletonBar height={24} radius={12} width={76} />
      <SkeletonBar height={24} radius={12} width={148} />
    </Flexbox>
    <SkeletonBar height={24} radius={12} width={96} />
  </Flexbox>
);

// The composer is one block, not two: the intro column's gap must not open a
// seam between the tray and the card it is tucked behind.
const ComposerSkeleton = () => (
  <div>
    <div {...stylex.props(styles.trayFrame)}>
      <TraySkeleton />
    </div>
    <Flexbox className={stylex.props(styles.card).className} gap={10} justify={'space-between'}>
      <SkeletonBar height={14} radius={7} width={'46%'} />
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <SkeletonBar height={24} radius={'50%'} width={24} />
        <SkeletonBar height={28} radius={'50%'} width={28} />
      </Flexbox>
    </Flexbox>
  </div>
);

const ProjectHomeSkeleton = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <div {...stylex.props(styles.page)}>
      <Flexbox className={stylex.props(styles.intro).className} gap={18}>
        <Flexbox align={'center'} gap={5}>
          <SkeletonBar height={26} radius={8} width={248} />
          <SkeletonBar height={14} radius={7} width={412} />
        </Flexbox>
        <ComposerSkeleton />
      </Flexbox>
    </div>
  </Flexbox>
);

export default ProjectHomeSkeleton;
