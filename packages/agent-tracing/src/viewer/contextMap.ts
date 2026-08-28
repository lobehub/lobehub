import {
  collectBreakReasons,
  type ContextCall,
  type ContextMap,
  type ContextSegment,
  type SegmentKind,
} from '../analysis/contextMap';
import {
  ansi,
  FAMILY_LABEL,
  FAMILY_ORDER,
  KIND_LABEL,
  KINDS_BY_FAMILY,
  TERMINAL_KIND_COLOR,
  TERMINAL_LANE_COLOR,
} from './contextMapPalette';

// ANSI helpers — weight from the terminal's own attributes, hue from the LobeHub scales.
const dim = (s: string) => `\x1B[2m${s}\x1B[22m`;
const bold = (s: string) => `\x1B[1m${s}\x1B[22m`;
const red = (s: string) => ansi(TERMINAL_LANE_COLOR.miss, s);
const green = (s: string) => ansi(TERMINAL_LANE_COLOR.hit, s);
const cyan = (s: string) => `\x1B[36m${s}\x1B[39m`;

/** Left gutter: `call NN · step NN` plus the token column, padded to a fixed width. */
const LABEL_WIDTH = 20;
const TOKEN_WIDTH = 8;
const GUTTER = LABEL_WIDTH + TOKEN_WIDTH + 2;

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * The token count one full track represents. Scaling to the context window is what makes
 * headroom visible, but on a 1M-token window a 50k payload collapses into a few cells and
 * the composition becomes unreadable — so fall back to the largest call when the window
 * dwarfs the payloads, and say so in the header.
 */
export function resolveScaleBasis(
  map: ContextMap,
  fullWindow = false,
): { basis: number; scaledToWindow: boolean } {
  const window = map.contextWindowTokens;
  const largest = Math.max(1, map.summary.maxCallTokens);
  if (!window) return { basis: largest, scaledToWindow: false };
  if (fullWindow || largest / window >= 0.35) return { basis: window, scaledToWindow: true };
  return { basis: largest, scaledToWindow: false };
}

/**
 * Distribute the track's cells across a call's segments by largest remainder, so widths stay
 * proportional — a rounding floor would make a 200-token segment look like a 20k one.
 * Segments too small to earn a cell are dropped rather than inflated.
 */
function allocateCells(
  call: ContextCall,
  scale: number,
  width: number,
): { cells: number[]; drawn: ContextSegment[] } {
  const drawn = call.segments.filter((s) => s.tokens > 0);
  const exact = drawn.map((s) => s.tokens * scale);
  const cells = exact.map((v) => Math.floor(v));
  const target = Math.min(width, Math.round(call.totalTokens * scale));

  let short = target - cells.reduce((sum, c) => sum + c, 0);
  const byRemainder = exact
    .map((v, i) => ({ i, remainder: v - Math.floor(v) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { i } of byRemainder) {
    if (short <= 0) break;
    cells[i] += 1;
    short -= 1;
  }
  return { cells, drawn };
}

/**
 * Cached segments are drawn shaded and re-processed ones solid, so the fill reinforces the
 * cache ruler printed underneath the track.
 */
function renderTrack(call: ContextCall, scale: number, width: number): string {
  const { cells, drawn } = allocateCells(call, scale, width);
  let out = '';
  let used = 0;
  for (const [i, segment] of drawn.entries()) {
    if (cells[i] <= 0 || used + cells[i] > width) continue;
    used += cells[i];
    const char = segment.unchanged ? '▓' : '█';
    out += ansi(TERMINAL_KIND_COLOR[segment.kind], char.repeat(cells[i]));
  }
  return out + dim('·'.repeat(Math.max(0, width - used)));
}

/**
 * The line under a track: a bracket spanning exactly the prefix the provider can serve
 * from cache, then the break marker at the column where reuse stops. Reading down the
 * column of brackets shows at a glance which calls kept their cache and which lost it.
 */
function renderCacheRuler(call: ContextCall, scale: number, width: number): string {
  const cachedCells = Math.min(width, Math.round(call.cachedTokens * scale));
  const newTokens = call.totalTokens - call.cachedTokens;

  // The bracket is pure geometry — it spans the cached prefix. The figure always lives in
  // the trailing text so a narrow hit (the interesting case) still reports its size.
  const bracket = cachedCells >= 2 ? green(`╰${'─'.repeat(cachedCells - 2)}╯`) : '';

  if (call.callIndex === 0) {
    return dim(`${' '.repeat(cachedCells)}▲ cold start · ${fmtTokens(call.totalTokens)} uncached`);
  }
  if (call.breakMessageIndex === undefined) {
    return (
      bracket +
      green(` cache hit ${fmtTokens(call.cachedTokens)}`) +
      dim(newTokens > 0 ? ` · +${fmtTokens(newTokens)} new` : ' · no new tokens')
    );
  }
  return (
    bracket +
    red(`▲ BREAK at msg[${call.breakMessageIndex}] · ${call.breakReason}`) +
    dim(
      ` · ${call.cachedTokens > 0 ? `cache hit only ${fmtTokens(call.cachedTokens)}` : 'no cache hit'} · ${fmtTokens(call.reprocessedTokens)} re-processed` +
        (call.wastedTokens > 0 ? ` (${fmtTokens(call.wastedTokens)} unchanged)` : ''),
    )
  );
}

export function renderContextMap(
  map: ContextMap,
  options: { fullWindow?: boolean; width?: number } = {},
): string {
  const lines: string[] = [];
  const { summary } = map;

  if (map.calls.length === 0) {
    return red('No LLM payloads found in this snapshot (no contextEngine.output recorded).');
  }

  const track =
    options.width ?? Math.min(Math.max((process.stdout.columns ?? 100) - GUTTER - 4, 40), 100);
  const { basis, scaledToWindow } = resolveScaleBasis(map, options.fullWindow);
  const scale = track / basis;

  const modelLabel = [map.model, map.provider].filter(Boolean).join('/') || 'unknown model';
  const windowNote = map.contextWindowTokens
    ? scaledToWindow
      ? `window ${fmtTokens(map.contextWindowTokens)}`
      : `window ${fmtTokens(map.contextWindowTokens)} (only ${Math.round((summary.maxCallTokens / map.contextWindowTokens) * 100)}% used — track scaled to the largest call)`
    : 'window unknown — track scaled to the largest call';
  lines.push(
    `${bold('ctx-map')}  ${cyan(map.operationId)}  ${modelLabel}  ` +
      dim(`${summary.llmCalls} LLM calls · ${windowNote} · source=${map.payloadSource}`),
  );
  lines.push('');

  for (const call of map.calls) {
    const head =
      `call ${String(call.callIndex + 1).padStart(2)} · step ${String(call.stepIndex).padStart(2)}`.padEnd(
        LABEL_WIDTH,
      ) + fmtTokens(call.totalTokens).padStart(TOKEN_WIDTH);
    lines.push(`${bold(head)}  ${renderTrack(call, scale, track)}`);
    lines.push(`${' '.repeat(GUTTER)}${renderCacheRuler(call, scale, track)}`);
  }

  lines.push('');
  lines.push(
    bold('final window'.padEnd(GUTTER)) + dim(`${fmtTokens(summary.maxCallTokens)} total`),
  );
  for (const family of FAMILY_ORDER) {
    const entries = KINDS_BY_FAMILY[family]
      .filter((kind) => summary.kindTokens[kind] > 0)
      .map(
        (kind) =>
          `${ansi(TERMINAL_KIND_COLOR[kind], '████')} ${KIND_LABEL[kind]} ${fmtTokens(summary.kindTokens[kind])}`,
      );
    if (entries.length > 0) {
      lines.push(`  ${dim(FAMILY_LABEL[family].padEnd(14))}${entries.join('   ')}`);
    }
  }
  lines.push(dim(`  ${'fill'.padEnd(14)}▓ served from cache   █ re-processed by the model`));

  if (summary.brokenPrefixCalls > 0) {
    lines.push('');
    lines.push(
      `${red('▲')} ${bold(`${summary.brokenPrefixCalls}/${summary.llmCalls}`)} calls broke their prefix cache` +
        (summary.totalWastedTokens > 0
          ? `, re-processing ${bold(fmtTokens(summary.totalWastedTokens))} tokens of ${bold('unchanged')} context `
          : ' ') +
        dim(`(${fmtTokens(summary.totalReprocessedTokens)} re-processed in total)`),
    );
    for (const { count, reason, wasted } of collectBreakReasons(map).slice(0, 5)) {
      const waste = wasted > 0 ? dim(`, −${fmtTokens(wasted)} tok unchanged`) : '';
      lines.push(`  ${dim('─')} ${reason} ${dim(`×${count}`)}${waste}`);
    }
  }

  return lines.join('\n');
}

export type { SegmentKind };
