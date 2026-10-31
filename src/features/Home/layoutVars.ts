import { type CSSProperties } from 'react';

import {
  getHomePortraitOverlap,
  HOME_PORTRAIT_CARD_GAP,
  HOME_PORTRAIT_HEIGHT,
  HOME_PORTRAIT_INSET,
  HOME_PORTRAIT_WIDTH,
} from './portraitFraming';

/** Trailing gutter that keeps the rail's cards off the page's scroll lane. */
const RAIL_GUTTER = 14;
const RAIL_CARD_WIDTH = 380;
const RAIL_COLUMN_GAP = 28;
const RAIL_EXIT_OFFSET = 24;
const RAIL_TRANSITION_DURATION = 220;
const RAIL_RECLAIMED_WIDTH = RAIL_CARD_WIDTH + RAIL_GUTTER + RAIL_COLUMN_GAP;
/** Portrait width plus its inline inset and the gap it keeps from the text. */
const PORTRAIT_LANE = HOME_PORTRAIT_WIDTH + HOME_PORTRAIT_INSET + 16;
/** Reclaim the artwork's full lane so collapsing never narrows the text above. */
const COLLAPSED_CONTENT_GAIN = PORTRAIT_LANE;
const COLLAPSED_CONTENT_OFFSET = (RAIL_RECLAIMED_WIDTH - COLLAPSED_CONTENT_GAIN) / 2;
const SPEECH_BUBBLE_MIN = 320;
const SPEECH_GREETING_GAP = 24;
const SPEECH_GREETING_MIN = 320;
const SPEECH_RESERVED_WIDTH =
  COLLAPSED_CONTENT_OFFSET * 2 + SPEECH_GREETING_GAP + SPEECH_BUBBLE_MIN + PORTRAIT_LANE;
/** Use the tighter rail state so its animation cannot switch rows or rewrap text. */
export const SPEECH_INLINE_MIN = SPEECH_RESERVED_WIDTH + SPEECH_GREETING_MIN;
const COMPACT_PORTRAIT_HEIGHT = 150;
const COMPACT_PORTRAIT_WIDTH =
  HOME_PORTRAIT_WIDTH * (COMPACT_PORTRAIT_HEIGHT / HOME_PORTRAIT_HEIGHT);
const COMPACT_PORTRAIT_OVERLAP = getHomePortraitOverlap(COMPACT_PORTRAIT_HEIGHT);
export const MINIMAL_STACK_GAP = 24;
/**
 * The minimal header stacks the agent switcher (24px avatar + 2px paddings,
 * from AgentSelect) over the greeting line (22px × 1.4, from HomeHeader) with
 * an 8px gap. That stack's height plus the gap below it is what the block must
 * shed under itself to land the composer, not the stack's midpoint, on the
 * center of the lane.
 */
const MINIMAL_GREETING_LINE = Math.round(22 * 1.4);
const MINIMAL_SWITCHER_ROW = 28;
const MINIMAL_HEADER_GAP = 8;
const MINIMAL_HEADER_HEIGHT = MINIMAL_SWITCHER_ROW + MINIMAL_HEADER_GAP + MINIMAL_GREETING_LINE;
const MINIMAL_LIFT = MINIMAL_HEADER_HEIGHT + MINIMAL_STACK_GAP;

/**
 * Layout numbers for `index.module.css`, derived here so they stay in step with
 * `portraitFraming.ts`. The container-query threshold cannot take a custom
 * property; `layoutVars.test.ts` pins the literal to `SPEECH_INLINE_MIN`.
 */
export const homeLayoutVars = {
  '--home-card-gap': `${HOME_PORTRAIT_CARD_GAP}px`,
  '--home-collapsed-gain': `${COLLAPSED_CONTENT_GAIN}px`,
  '--home-collapsed-offset': `${COLLAPSED_CONTENT_OFFSET}px`,
  '--home-column-gap': `${RAIL_COLUMN_GAP}px`,
  '--home-compact-portrait-height': `${COMPACT_PORTRAIT_HEIGHT}px`,
  '--home-compact-portrait-overlap': `-${COMPACT_PORTRAIT_OVERLAP}px`,
  '--home-compact-portrait-visible': `${COMPACT_PORTRAIT_HEIGHT - COMPACT_PORTRAIT_OVERLAP}px`,
  '--home-compact-portrait-width': `${COMPACT_PORTRAIT_WIDTH}px`,
  '--home-full-portrait-height': `${HOME_PORTRAIT_HEIGHT}px`,
  '--home-full-portrait-overlap': `-${getHomePortraitOverlap(HOME_PORTRAIT_HEIGHT)}px`,
  '--home-full-portrait-width': `${HOME_PORTRAIT_WIDTH}px`,
  '--home-portrait-inset': `${HOME_PORTRAIT_INSET}px`,
  '--home-rail-exit': `${RAIL_EXIT_OFFSET}px`,
  '--home-rail-gutter': `${RAIL_GUTTER}px`,
  '--home-rail-track': `${RAIL_CARD_WIDTH + RAIL_GUTTER}px`,
  '--home-rail-transition': `${RAIL_TRANSITION_DURATION}ms`,
  '--home-speech-gap': `${SPEECH_GREETING_GAP}px`,
  '--home-speech-reserved': `${COLLAPSED_CONTENT_OFFSET * 2 + SPEECH_GREETING_MIN + SPEECH_GREETING_GAP}px`,
} as CSSProperties;

export const minimalVars = { '--home-minimal-lift': `${MINIMAL_LIFT}px` } as CSSProperties;
