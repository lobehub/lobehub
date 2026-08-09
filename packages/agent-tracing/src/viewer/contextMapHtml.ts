import {
  collectBreakReasons,
  type ContextCall,
  type ContextMap,
  type ContextSegment,
} from '../analysis/contextMap';
import { fmtTokens, resolveScaleBasis } from './contextMap';
import {
  FAMILY_LABEL,
  FAMILY_ORDER,
  HTML_THEME,
  KIND_LABEL,
  KINDS_BY_FAMILY,
  type LaneTone,
  type ThemeColors,
} from './contextMapPalette';

/**
 * Standalone HTML rendering of a {@link ContextMap} — one row per LLM call, segment
 * width proportional to tokens, against the model's context window as the track.
 * Self-contained (no assets, no scripts) so it can be dropped into a PR or an issue.
 *
 * Three things carry the story, in this order of visual weight: the cache band under each
 * track (how much of this call the provider could reuse), the break marker (where reuse
 * stopped and why), and the segment colors (what the window is made of).
 *
 * Colors come from the LobeHub scales via CSS custom properties, so the light and dark
 * variants are the same document — the report follows the reader's system theme.
 */

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Flatten a theme into the custom properties the stylesheet and inline widths reference. */
function themeVars(theme: ThemeColors): string {
  const entries: string[] = [
    `--surface: ${theme.surface}`,
    `--surface-raised: ${theme.surfaceRaised}`,
    `--track-bg: ${theme.trackBg}`,
    `--border: ${theme.border}`,
    `--divider: ${theme.divider}`,
    `--hatch: ${theme.hatch}`,
    `--text: ${theme.text}`,
    `--text-dim: ${theme.textDim}`,
    `--tip-bg: ${theme.tipBg}`,
    `--tip-text: ${theme.tipText}`,
  ];
  for (const [kind, color] of Object.entries(theme.kind)) entries.push(`--kind-${kind}: ${color}`);
  for (const [tone, color] of Object.entries(theme.lane)) entries.push(`--lane-${tone}: ${color}`);
  for (const [tone, color] of Object.entries(theme.laneText)) {
    entries.push(`--lane-text-${tone}: ${color}`);
  }
  return entries.join(';\n    ') + ';';
}

const STYLE = `
  :root {
    ${themeVars(HTML_THEME.light)}
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      ${themeVars(HTML_THEME.dark)}
    }
  }

  * { box-sizing: border-box; }
  body { background: var(--surface); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; margin: 0; padding: 40px 48px; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .sub { color: var(--text-dim); font-size: 13px; line-height: 1.7; margin-bottom: 34px; }
  .sub code { background: var(--surface-raised); border-radius: 4px; padding: 1px 5px; }

  .row { align-items: flex-start; display: flex; gap: 16px; margin-bottom: 22px; }
  .label { flex: 0 0 178px; padding-top: 14px; text-align: right; }
  .label .name { font-size: 14px; font-weight: 600; }
  .label .tokens { color: var(--text-dim); font-size: 12px; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .lanes { flex: 1; min-width: 0; }

  .track { align-items: stretch; background: var(--track-bg); border: 1.5px solid var(--border); border-radius: 8px; display: flex; gap: 3px; height: 58px; padding: 4px; position: relative; }
  /* Preserve the original message geometry: the frame's padding and the track gap make each
     payload message read as a distinct object. Every role uses the same neutral frame. */
  .msg { background: transparent; border-radius: 7px; box-shadow: inset 0 0 0 2px var(--border); display: flex; gap: 1px; padding: 3px; position: relative; }
  .seg { border-radius: 3px; min-width: 1px; position: relative; }
  /* Cache hits recede through opacity alone. Hatching is reserved for context the model had
     to re-process after a prefix break, so the two cache states never compete visually. */
  .seg.cached { opacity: 0.4; }
  .seg.reprocessed::before { background-image: repeating-linear-gradient(45deg, var(--hatch) 0 3px, transparent 3px 7px); content: ''; inset: 0; position: absolute; }
  .inject-mark { align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; color: var(--text); display: flex; font-size: 7px; font-weight: 700; height: 13px; justify-content: center; letter-spacing: -0.02em; position: absolute; right: -5px; top: -7px; width: 13px; z-index: 12; }
  .seg .tip { background: var(--tip-bg); border-radius: 6px; bottom: calc(100% + 10px); color: var(--tip-text); display: none; font-size: 12px; left: 0; line-height: 1.5; max-width: 460px; padding: 8px 10px; position: absolute; width: max-content; z-index: 20; }
  .seg:hover .tip { display: block; }
  .seg .tip b { color: var(--kind-injected); }

  /* Break marker: a full-bleed rule through the track with the reason anchored to it. */
  .cut { border-left: 2px solid var(--lane-miss); bottom: -7px; position: absolute; top: -7px; z-index: 10; }
  .cut::before { border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 7px solid var(--lane-miss); content: ''; left: -7px; position: absolute; top: -7px; }

  /* Cache lane: bands carry the geometry only — the figures live on the line below, where
     no amount of proportional narrowing can clip them. */
  .lane { display: flex; gap: 3px; height: 9px; margin-top: 5px; }
  .band { border-radius: 3px; }
  .band.hit { background: var(--lane-hit); }
  .band.miss { background: var(--lane-miss); }
  .band.cold { background: var(--lane-cold); }
  .band.new { background: var(--lane-new); }
  .lanetext { font-size: 11.5px; margin-top: 5px; }
  .lanetext .hit { color: var(--lane-text-hit); }
  .lanetext .miss { color: var(--lane-text-miss); font-weight: 600; }
  .lanetext .cold { color: var(--lane-text-cold); }
  .lanetext .new { color: var(--lane-text-new); }
  .lanetext .sep { color: var(--divider); padding: 0 6px; }

  .legend { border-top: 1px solid var(--divider); margin-top: 34px; padding-top: 20px; }
  .legend h2 { font-size: 13px; letter-spacing: 0.04em; margin: 0 0 14px; text-transform: uppercase; }
  .family { align-items: baseline; display: flex; gap: 14px; margin-bottom: 9px; }
  .family .fname { color: var(--text-dim); flex: 0 0 110px; font-size: 12px; text-align: right; }
  .family .items { display: flex; flex-wrap: wrap; gap: 18px; }
  .family .items div { align-items: center; display: flex; font-size: 13px; gap: 7px; }
  .family .items span.num { color: var(--text-dim); }
  .swatch { border-radius: 4px; display: inline-block; height: 14px; width: 26px; }
  .swatch.frame { background: transparent; border: 2px solid var(--border); }
  .swatch.cached { opacity: 0.4; }
  .swatch.hatch { background-image: repeating-linear-gradient(45deg, var(--hatch) 0 3px, transparent 3px 7px); }
  .swatch.injected { position: relative; }
  .swatch.injected::after { align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; color: var(--text); content: 'I'; display: flex; font-size: 6px; font-weight: 700; height: 10px; justify-content: center; position: absolute; right: -4px; top: -5px; width: 10px; }

  .summary { background: var(--surface-raised); border: 1px solid var(--divider); border-radius: 8px; font-size: 13px; line-height: 1.8; margin-top: 28px; padding: 16px 20px; }
  .summary b { color: var(--lane-text-miss); }
  .summary ul { margin: 8px 0 0; padding-left: 20px; }
`;

interface MessageGroup {
  messageIndex: number;
  segments: ContextSegment[];
  tokens: number;
}

/** Collapse a call's flat segment list back into the messages they came from. */
function groupByMessage(call: ContextCall): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const segment of call.segments) {
    if (segment.tokens <= 0) continue;
    const last = groups.at(-1);
    if (last?.messageIndex === segment.messageIndex) {
      last.segments.push(segment);
      last.tokens += segment.tokens;
      continue;
    }
    groups.push({
      messageIndex: segment.messageIndex,
      segments: [segment],
      tokens: segment.tokens,
    });
  }
  return groups;
}

export function renderContextMapHtml(
  map: ContextMap,
  options: { fullWindow?: boolean } = {},
): string {
  const { summary } = map;
  const { basis, scaledToWindow } = resolveScaleBasis(map, options.fullWindow);
  const modelLabel = [map.model, map.provider].filter(Boolean).join(' / ') || 'unknown model';
  const pct = (tokens: number) => (tokens / Math.max(1, basis)) * 100;

  const rows = map.calls
    .map((call) => {
      let offset = 0;
      let cutLeft: number | undefined;
      const messages = groupByMessage(call)
        .map((message) => {
          if (
            cutLeft === undefined &&
            call.breakMessageIndex !== undefined &&
            message.messageIndex >= call.breakMessageIndex
          ) {
            cutLeft = offset;
          }
          offset += pct(message.tokens);

          const isInjected = message.segments.some((segment) => segment.kind === 'injected');
          const segments = message.segments
            .map((segment) => {
              const cacheState = segment.unchanged
                ? 'cached'
                : call.breakMessageIndex === undefined
                  ? 'new'
                  : 'reprocessed';
              const cacheLabel =
                cacheState === 'cached'
                  ? 'served from cache'
                  : cacheState === 'reprocessed'
                    ? 're-processed'
                    : 'new context';
              const colorKind = segment.kind === 'injected' ? segment.role : segment.kind;
              const tip = `msg[${segment.messageIndex}] · ${KIND_LABEL[segment.kind]} · ${fmtTokens(segment.tokens)} tok · ${cacheLabel}<br><b>${escapeHtml(segment.label)}</b><br>${escapeHtml(segment.preview)}`;
              return `<div class="seg ${cacheState}" style="background:var(--kind-${colorKind});flex:${segment.tokens} 1 0"><span class="tip">${tip}</span></div>`;
            })
            .join('');
          const injectedMark = isInjected
            ? '<span class="inject-mark" title="Framework injected">I</span>'
            : '';
          return `<div class="msg" data-message-index="${message.messageIndex}" style="width:${pct(message.tokens).toFixed(3)}%">${segments}${injectedMark}</div>`;
        })
        .join('');

      const cut =
        cutLeft === undefined
          ? ''
          : `<div class="cut" style="left:calc(4px + ${cutLeft.toFixed(3)}%)"></div>`;

      // The lane restates the row as cache economics: what was reused, what was paid for.
      const restTone: LaneTone =
        call.callIndex === 0 ? 'cold' : call.breakMessageIndex === undefined ? 'new' : 'miss';
      const band = (tone: LaneTone, tokens: number) =>
        tokens > 0
          ? `<div class="band ${tone}" style="width:${pct(tokens).toFixed(3)}%"></div>`
          : '';
      const lane = band('hit', call.cachedTokens) + band(restTone, call.reprocessedTokens);

      const sep = '<span class="sep">·</span>';
      const hitText =
        call.cachedTokens > 0
          ? `<span class="hit">✓ cache hit ${fmtTokens(call.cachedTokens)}</span>`
          : '';
      const restText =
        call.callIndex === 0
          ? `<span class="cold">cold start — ${fmtTokens(call.totalTokens)} uncached</span>`
          : call.breakMessageIndex === undefined
            ? `<span class="new">${call.reprocessedTokens > 0 ? `+${fmtTokens(call.reprocessedTokens)} new` : 'identical payload — nothing re-processed'}</span>`
            : `<span class="miss">▲ cache broke at msg[${call.breakMessageIndex}] — ${escapeHtml(call.breakReason ?? '')}</span>${sep}<span class="miss">✂ ${fmtTokens(call.reprocessedTokens)} re-processed${call.wastedTokens > 0 ? `, ${fmtTokens(call.wastedTokens)} of it unchanged` : ''}</span>`;
      const laneText = [hitText, restText].filter(Boolean).join(sep);

      const share = map.contextWindowTokens
        ? ` · ${Math.round((call.totalTokens / map.contextWindowTokens) * 100)}% of window`
        : '';

      return `<div class="row">
      <div class="label">
        <div class="name">Call ${call.callIndex + 1}</div>
        <div class="tokens">step ${call.stepIndex} · ${fmtTokens(call.totalTokens)} tok${share}</div>
      </div>
      <div class="lanes">
        <div class="track">${messages}${cut}</div>
        <div class="lane">${lane}</div>
        <div class="lanetext">${laneText}</div>
      </div>
    </div>`;
    })
    .join('\n');

  const legend = FAMILY_ORDER.map((family) => {
    const items = KINDS_BY_FAMILY[family]
      .filter((kind) => summary.kindTokens[kind] > 0)
      .map(
        (kind) =>
          `<div><span class="swatch${kind === 'injected' ? ' injected' : ''}" style="background:var(--kind-${kind === 'injected' ? 'user' : kind})"></span>${KIND_LABEL[kind]} <span class="num">${fmtTokens(summary.kindTokens[kind])}</span></div>`,
      )
      .join('');
    return items
      ? `<div class="family"><div class="fname">${FAMILY_LABEL[family]}</div><div class="items">${items}</div></div>`
      : '';
  }).join('');

  const summaryBlock =
    summary.brokenPrefixCalls === 0
      ? ''
      : `<div class="summary">
      <b>${summary.brokenPrefixCalls} / ${summary.llmCalls}</b> calls broke their prefix cache${
        summary.totalWastedTokens > 0
          ? `, re-processing <b>${fmtTokens(summary.totalWastedTokens)}</b> tokens of context that had not changed`
          : ''
      }
      (${fmtTokens(summary.totalReprocessedTokens)} re-processed in total).
      <ul>${collectBreakReasons(map)
        .slice(0, 5)
        .map(
          ({ count, reason, wasted }) =>
            `<li>${escapeHtml(reason)} ×${count}${wasted > 0 ? ` — ${fmtTokens(wasted)} tok unchanged` : ''}</li>`,
        )
        .join('')}</ul>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ctx-map · ${escapeHtml(map.operationId)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Context window composition per LLM call</h1>
<div class="sub">
  <code>${escapeHtml(map.operationId)}</code> · ${escapeHtml(modelLabel)} ·
  ${summary.llmCalls} calls · ${
    map.contextWindowTokens
      ? `window ${fmtTokens(map.contextWindowTokens)}${scaledToWindow ? '' : ` (only ${Math.round((summary.maxCallTokens / map.contextWindowTokens) * 100)}% used — track scaled to the largest call)`}`
      : 'window unknown — track scaled to the largest call'
  } ·
  source=${map.payloadSource}<br>
  Each row is one context window snapshot · neutral frames mark message boundaries while block
  color identifies system, user, assistant, and tool context · the band below splits what the prefix
  cache served and what the model had to re-process
</div>
${rows}
<div class="legend">
  <h2>Final window · ${fmtTokens(summary.maxCallTokens)}</h2>
  ${legend}
  <div class="family"><div class="fname">Fill</div><div class="items">
    <div><span class="swatch frame"></span>message boundary</div>
    <div><span class="swatch cached" style="background:var(--kind-tool_call)"></span>served from cache</div>
    <div><span class="swatch hatch" style="background-color:var(--kind-tool_call)"></span>re-processed by the model</div>
  </div></div>
</div>
${summaryBlock}
</body>
</html>
`;
}
