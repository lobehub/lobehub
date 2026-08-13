import type { SegmentKind } from '../analysis/contextMap';
import { blue, type ColorScale, green, orange, red, sand, slate } from './contextMapScales';

/**
 * Palette for the context map, built from the LobeHub scales (vendored in
 * `contextMapScales.ts`) so the report reads as part of the product rather than a one-off
 * chart theme. Every value below is a step index into a scale — nothing is hand-picked.
 *
 * Role is the primary encoding: orange system, green user, blue assistant, gray tool.
 * Assistant internals use different steps of the same blue scale. Injected content inherits
 * the color of the role carrying it; the HTML renderer marks injection separately.
 */

export type SegmentFamily = 'framework' | 'conversation' | 'execution';

/** Cache economics of a span: reused, re-processed after a break, appended, or uncached. */
export type LaneTone = 'hit' | 'miss' | 'new' | 'cold';

export const FAMILY_LABEL: Record<SegmentFamily, string> = {
  conversation: 'Conversation',
  execution: 'Execution',
  framework: 'Framework',
};

/** Families in the order they typically appear in a payload. */
export const FAMILY_ORDER: SegmentFamily[] = ['framework', 'conversation', 'execution'];

export const KIND_LABEL: Record<SegmentKind, string> = {
  assistant: 'Assistant',
  injected: 'Injected block',
  reasoning: 'Reasoning',
  system: 'System',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
  user: 'User turn',
};

/** Ordered by reading flow inside each family. */
export const KINDS_BY_FAMILY: Record<SegmentFamily, SegmentKind[]> = {
  conversation: ['user', 'assistant'],
  execution: ['reasoning', 'tool_call', 'tool_result'],
  framework: ['system', 'injected'],
};

/**
 * Step indices per kind. Light themes descend the scale (dark = prominent), dark themes
 * ascend it, so "most prominent member of the family" holds either way.
 */
const KIND_STEPS: Record<SegmentKind, { dark: number; light: number; scale: ColorScale }> = {
  system: { dark: 9, light: 9, scale: orange },
  injected: { dark: 6, light: 7, scale: orange },
  user: { dark: 8, light: 9, scale: green },
  reasoning: { dark: 10, light: 6, scale: blue },
  tool_call: { dark: 8, light: 8, scale: blue },
  assistant: { dark: 6, light: 10, scale: blue },
  tool_result: { dark: 7, light: 7, scale: slate },
};

const LANE_STEPS: Record<LaneTone, { dark: number; light: number; scale: ColorScale }> = {
  hit: { dark: 9, light: 9, scale: green },
  miss: { dark: 9, light: 9, scale: red },
  new: { dark: 7, light: 8, scale: blue },
  cold: { dark: 6, light: 6, scale: slate },
};

/** Lane text needs to carry contrast against the page, so it sits a step further out. */
const LANE_TEXT_STEPS: Record<LaneTone, { dark: number; light: number; scale: ColorScale }> = {
  hit: { dark: 10, light: 10, scale: green },
  miss: { dark: 10, light: 10, scale: red },
  new: { dark: 10, light: 10, scale: blue },
  cold: { dark: 10, light: 10, scale: slate },
};

const pick = (
  steps: { dark: number; light: number; scale: ColorScale },
  theme: 'light' | 'dark',
) => (theme === 'light' ? steps.scale.light[steps.light] : steps.scale.dark[steps.dark]);

const mapSteps = <K extends string>(
  steps: Record<K, { dark: number; light: number; scale: ColorScale }>,
  theme: 'light' | 'dark',
) =>
  Object.fromEntries(
    Object.entries<{ dark: number; light: number; scale: ColorScale }>(steps).map(([key, step]) => [
      key,
      pick(step, theme),
    ]),
  ) as Record<K, string>;

export interface ThemeColors {
  border: string;
  divider: string;
  /** Stripe overlay marking re-processed segments — must darken on light, lighten on dark. */
  hatch: string;
  kind: Record<SegmentKind, string>;
  lane: Record<LaneTone, string>;
  laneText: Record<LaneTone, string>;
  /** Page background. */
  surface: string;
  /** Raised surface: code chips, legend swatch backdrop. */
  surfaceRaised: string;
  text: string;
  textDim: string;
  tipBg: string;
  tipText: string;
  trackBg: string;
}

function buildTheme(theme: 'light' | 'dark'): ThemeColors {
  const neutral = theme === 'light' ? sand.light : sand.dark;
  const structure = theme === 'light' ? slate.light : slate.dark;
  return {
    border: theme === 'light' ? structure[11] : structure[7],
    divider: neutral[3],
    hatch: theme === 'light' ? 'rgba(0, 0, 0, 0.26)' : 'rgba(255, 255, 255, 0.3)',
    kind: mapSteps(KIND_STEPS, theme),
    lane: mapSteps(LANE_STEPS, theme),
    laneText: mapSteps(LANE_TEXT_STEPS, theme),
    surface: neutral[1],
    surfaceRaised: neutral[2],
    text: structure[12],
    textDim: structure[10],
    tipBg: theme === 'light' ? structure[12] : neutral[3],
    tipText: theme === 'light' ? neutral[0] : structure[12],
    trackBg: neutral[2],
  };
}

export const HTML_THEME: Record<'light' | 'dark', ThemeColors> = {
  dark: buildTheme('dark'),
  light: buildTheme('light'),
};

/**
 * A terminal may be light or dark and cannot tell us which, so it uses the mid steps of the
 * light scales — saturated enough to read on a dark background, dark enough on a light one.
 */
export const TERMINAL_KIND_COLOR: Record<SegmentKind, string> = {
  system: orange.light[9],
  injected: orange.light[7],
  user: green.light[9],
  reasoning: blue.light[6],
  tool_call: blue.light[8],
  assistant: blue.light[10],
  tool_result: slate.light[7],
};

export const TERMINAL_LANE_COLOR: Record<LaneTone, string> = {
  cold: slate.light[8],
  hit: green.light[9],
  miss: red.light[9],
  new: blue.light[9],
};

/** 24-bit foreground color — the ramps need more than the 8 ANSI slots. */
export function ansi(hex: string, text: string): string {
  if (process.env.NO_COLOR) return text;
  const n = Number.parseInt(hex.slice(1), 16);
  return `\x1B[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m${text}\x1B[39m`;
}
