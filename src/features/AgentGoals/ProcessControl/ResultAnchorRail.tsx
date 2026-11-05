'use client';

import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { MIN_RAIL_ANCHORS } from './resultAnchors';
import { useResultAnchorRail } from './useResultAnchorRail';

/**
 * A scroll rail for the long 结果交付 page. At rest it is a column of ticks in
 * the page's right padding — one per section, shorter ones for the deliverable
 * groups inside 交付物 — with the section being read highlighted. Hovering it,
 * or tabbing to it, opens the section names; clicking one scrolls there.
 *
 * What it knows about the page comes from useResultAnchorRail; this file is the
 * column that draws it.
 */

// Hover, or keyboard focus: a click leaves focus behind, and an open panel
// that outlives the gesture would cover the page it just navigated.
const RAIL_OPEN = ':is(:hover, :has(:focus-visible))';
// StyleX cannot read constants imported from regular modules, so RAIL_TOP (96) and RAIL_ROW (22)
// are written out below; `stylexConstants.test.ts` keeps them in step with useResultAnchorRail.
const styles = stylex.create({
  host: { position: 'sticky', zIndex: 10, insetBlockStart: '96px', height: 0 },
  item: {
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: '100%',
    // Fixed, not a minimum: a row that grows taller when the labels open slides
    // every tick below it out from under the pointer between hover and click.
    height: '22px',
    padding: 0,
    borderStyle: 'none',
    color: cssVar.colorTextTertiary,
    textAlign: 'end',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  itemActive: { color: cssVar.colorText },
  label: {
    overflow: 'hidden',
    display: { default: 'none', [stylex.when.ancestor(RAIL_OPEN)]: 'block' },
    flex: '1',
    maxWidth: '240px',
    fontSize: '12px',
    // Matches the row height, so opening the labels changes nothing vertically.
    lineHeight: '22px',
    textAlign: 'start',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  labelChild: { paddingInlineStart: '12px' },
  rail: {
    position: 'absolute',
    insetBlockStart: 0,
    insetInlineEnd: '-16px',
    overflowX: 'hidden',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    maxHeight: 'calc(100vh - 192px)',
    paddingBlock: '6px',
    // The end padding must not change when the labels open: the ticks are
    // anchored to this edge, and a tick that moves out from under the pointer
    // between hover and click is a click that goes nowhere.
    paddingInlineStart: { default: '2px', [RAIL_OPEN]: '12px' },
    paddingInlineEnd: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: { default: 'transparent', [RAIL_OPEN]: cssVar.colorBorderSecondary },
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: { default: null, [RAIL_OPEN]: cssVar.colorBgElevated },
    backgroundImage: { default: null, [RAIL_OPEN]: 'none' },
    boxShadow: { default: null, [RAIL_OPEN]: cssVar.boxShadowSecondary },
    transition: `background 0.15s ${cssVar.motionEaseOut}, box-shadow 0.15s ${cssVar.motionEaseOut}`,
  },
  tick: {
    flex: 'none',
    width: '12px',
    height: '2px',
    borderRadius: '1px',
    backgroundColor: cssVar.colorFill,
    backgroundImage: 'none',
  },
  tickActive: { backgroundColor: cssVar.colorText },
  tickChild: { width: '7px' },
});

interface ResultAnchorRailProps {
  rootRef: RefObject<HTMLElement | null>;
}

const ResultAnchorRail = ({ rootRef }: ResultAnchorRailProps) => {
  const { t } = useTranslation('chat');
  const { active, anchors, edge, hostRef, jumpTo } = useResultAnchorRail({ rootRef });

  if (anchors.length < MIN_RAIL_ANCHORS) return null;

  return (
    <div {...stylex.props(styles.host)} ref={hostRef}>
      <nav
        aria-label={t('goalProcess.result.nav.label')}
        data-testid={'goal-result-anchor-rail'}
        {...sx([styles.rail, stylex.defaultMarker()], undefined, { insetInlineEnd: edge })}
      >
        {anchors.map((anchor, index) => {
          const isActive = index === active;
          return (
            <button
              aria-current={isActive ? 'location' : undefined}
              aria-label={anchor.label}
              className={stylex.props(styles.item, isActive && styles.itemActive).className}
              key={anchor.id}
              type={'button'}
              onClick={() => jumpTo(anchor.id)}
            >
              <span
                className={
                  stylex.props(styles.label, anchor.level === 1 && styles.labelChild).className
                }
              >
                {anchor.label}
              </span>
              <span
                className={
                  stylex.props(
                    styles.tick,
                    anchor.level === 1 && styles.tickChild,
                    isActive && styles.tickActive,
                  ).className
                }
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default ResultAnchorRail;
