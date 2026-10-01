'use client';

import { createStaticStyles, cssVar, cx } from 'antd-style';
import { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { MIN_RAIL_ANCHORS } from './resultAnchors';
import { RAIL_ROW, RAIL_TOP, useResultAnchorRail } from './useResultAnchorRail';

/**
 * A scroll rail for the long 结果交付 page. At rest it is a column of ticks in
 * the page's right padding — one per section, shorter ones for the deliverable
 * groups inside 交付物 — with the section being read highlighted. Hovering it,
 * or tabbing to it, opens the section names; clicking one scrolls there.
 *
 * What it knows about the page comes from useResultAnchorRail; this file is the
 * column that draws it.
 */

const styles = createStaticStyles(({ css }) => ({
  host: css`
    position: sticky;
    z-index: 10;
    inset-block-start: ${RAIL_TOP}px;
    height: 0;
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: flex-end;

    width: 100%;

    /* Fixed, not a minimum: a row that grows taller when the labels open slides
       every tick below it out from under the pointer between hover and click. */
    height: ${RAIL_ROW}px;
    padding: 0;
    border: none;

    color: ${cssVar.colorTextTertiary};
    text-align: end;

    background: none;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  itemActive: css`
    color: ${cssVar.colorText};
  `,
  label: css`
    overflow: hidden;
    display: none;
    flex: 1;

    max-width: 240px;

    font-size: 12px;

    /* Matches the row height, so opening the labels changes nothing vertically. */
    line-height: ${RAIL_ROW}px;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  labelChild: css`
    padding-inline-start: 12px;
  `,
  rail: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: -16px;

    overflow: hidden auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;

    max-height: calc(100vh - ${RAIL_TOP * 2}px);
    padding-block: 6px;

    /* The end padding must not change when the labels open: the ticks are
       anchored to this edge, and a tick that moves out from under the pointer
       between hover and click is a click that goes nowhere. */
    padding-inline: 2px 8px;
    border: 1px solid transparent;
    border-radius: ${cssVar.borderRadiusLG};

    transition:
      background 0.15s ${cssVar.motionEaseOut},
      box-shadow 0.15s ${cssVar.motionEaseOut};

    /* Hover, or keyboard focus: a click leaves focus behind, and an open panel
       that outlives the gesture would cover the page it just navigated. */
    &:hover,
    &:has(:focus-visible) {
      padding-inline-start: 12px;
      border-color: ${cssVar.colorBorderSecondary};
      background: ${cssVar.colorBgElevated};
      box-shadow: ${cssVar.boxShadowSecondary};

      .result-anchor-label {
        display: block;
      }
    }
  `,
  tick: css`
    flex: none;

    width: 12px;
    height: 2px;
    border-radius: 1px;

    background: ${cssVar.colorFill};
  `,
  tickActive: css`
    background: ${cssVar.colorText};
  `,
  tickChild: css`
    width: 7px;
  `,
}));

interface ResultAnchorRailProps {
  rootRef: RefObject<HTMLElement | null>;
}

const ResultAnchorRail = ({ rootRef }: ResultAnchorRailProps) => {
  const { t } = useTranslation('chat');
  const { active, anchors, edge, hostRef, jumpTo } = useResultAnchorRail({ rootRef });

  if (anchors.length < MIN_RAIL_ANCHORS) return null;

  return (
    <div className={styles.host} ref={hostRef}>
      <nav
        aria-label={t('goalProcess.result.nav.label')}
        className={styles.rail}
        data-testid={'goal-result-anchor-rail'}
        style={{ insetInlineEnd: edge }}
      >
        {anchors.map((anchor, index) => {
          const isActive = index === active;
          return (
            <button
              aria-current={isActive ? 'location' : undefined}
              aria-label={anchor.label}
              className={cx(styles.item, isActive && styles.itemActive)}
              key={anchor.id}
              type={'button'}
              onClick={() => jumpTo(anchor.id)}
            >
              <span
                className={cx(
                  'result-anchor-label',
                  styles.label,
                  anchor.level === 1 && styles.labelChild,
                )}
              >
                {anchor.label}
              </span>
              <span
                className={cx(
                  styles.tick,
                  anchor.level === 1 && styles.tickChild,
                  isActive && styles.tickActive,
                )}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default ResultAnchorRail;
