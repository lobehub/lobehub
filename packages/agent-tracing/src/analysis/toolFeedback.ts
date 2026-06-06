import { encode } from 'gpt-tokenizer';

import type { ExecutionSnapshot } from '../types';

/**
 * Objective (no-LLM) quality metrics for a single tool result — the "environment feedback"
 * an agent receives. These are the Phase-1 signals that can be computed over the whole
 * snapshot corpus to rank which tools pollute the context window.
 *
 * Semantic metrics that genuinely need a judge (feedback utility, actionability, failure
 * clarity, compressibility) are intentionally NOT here — they belong to a later phase.
 */
export interface ToolResultMetrics {
  apiName: string;
  /** Character length of the (unwrapped) content. */
  chars: number;
  format: 'json' | 'xml' | 'markdown' | 'text';
  identifier: string;
  /** `isSuccess === false`, or an error/stack signal in the head of the content. */
  isError: boolean;
  /** 0..1 — fraction of fixed-size shingles that are exact repeats (degenerate dumps). */
  selfRedundancy: number;
  stepIndex: number;
  /** 0..1 — for xml/html, share of chars living inside `<...>` tags (node ids, markup). */
  structuralNoiseRatio: number;
  /** gpt-tokenizer count of the unwrapped content. */
  tokens: number;
  /** `${identifier}/${apiName}` */
  tool: string;
}

const SHINGLE = 80;
const ERROR_HEAD = 2000;
const ERROR_RE = /\b(?:error|failed|failure|exception|enoent|econn|traceback|status\s+5\d\d)\b/i;

/** Tool outputs are frequently JSON-wrapped as `{"content":"..."}` — score the payload, not the envelope. */
function unwrapContent(output: string): string {
  const t = output.trimStart();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(output);
      if (o && typeof o.content === 'string') return o.content;
    } catch {
      // not JSON — score as-is
    }
  }
  return output;
}

function detectFormat(s: string): ToolResultMetrics['format'] {
  const h = s.trimStart();
  if (h.startsWith('{') || h.startsWith('[')) return 'json';
  if (h.startsWith('<')) return 'xml';
  if (/^[#*\-|>]/.test(h)) return 'markdown';
  return 'text';
}

function selfRedundancy(s: string): number {
  if (s.length < SHINGLE * 4) return 0;
  const shingles: string[] = [];
  for (let i = 0; i + SHINGLE <= s.length; i += SHINGLE) shingles.push(s.slice(i, i + SHINGLE));
  if (shingles.length === 0) return 0;
  return 1 - new Set(shingles).size / shingles.length;
}

function structuralNoiseRatio(s: string, format: ToolResultMetrics['format']): number {
  if (format !== 'xml' || s.length === 0) return 0;
  let inside = 0;
  const tags = s.match(/<[^>]*>/g);
  if (tags) for (const tag of tags) inside += tag.length;
  return inside / s.length;
}

/** Pure: score one raw tool output string. The shared core reused by CLI / DC ingestion / backfill. */
export function analyzeToolResult(
  rawOutput: string,
  isSuccess: boolean | undefined,
): Pick<
  ToolResultMetrics,
  'chars' | 'tokens' | 'format' | 'isError' | 'selfRedundancy' | 'structuralNoiseRatio'
> {
  const content = unwrapContent(rawOutput ?? '');
  const format = detectFormat(content);
  return {
    chars: content.length,
    format,
    isError: isSuccess === false || ERROR_RE.test(content.slice(0, ERROR_HEAD)),
    selfRedundancy: selfRedundancy(content),
    structuralNoiseRatio: structuralNoiseRatio(content, format),
    tokens: content ? encode(content).length : 0,
  };
}

/** Flatten every tool result in a snapshot into per-result metrics. */
export function collectToolResults(snapshot: ExecutionSnapshot): ToolResultMetrics[] {
  const out: ToolResultMetrics[] = [];
  for (const step of snapshot.steps) {
    const results = step.toolsResult;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (!r || typeof r.output !== 'string') continue;
      const identifier = r.identifier ?? '?';
      const apiName = r.apiName ?? '?';
      out.push({
        ...analyzeToolResult(r.output, r.isSuccess),
        apiName,
        identifier,
        stepIndex: step.stepIndex,
        tool: `${identifier}/${apiName}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Tokens of a result estimated to carry no useful signal — the basis for the dirty leaderboard. */
const ERROR_TOKEN_BUDGET = 200;
export function estWasteTokens(m: ToolResultMetrics): number {
  let noise = m.selfRedundancy + m.structuralNoiseRatio;
  if (m.isError) noise += Math.min(1, m.tokens / ERROR_TOKEN_BUDGET) * 0.5;
  return m.tokens * Math.min(1, noise);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Op-level rollup — the candidate shape for the `agent_operations` analytics column (lobehub side). */
export interface OpToolFeedbackRollup {
  errorResultCount: number;
  errorResultTokens: number;
  operationId: string;
  resultCount: number;
  selfRedundancyMax: number;
  structuralNoiseAvg: number;
  tokensMax: number;
  tokensP50: number;
  tokensP90: number;
  tokensP99: number;
  tokensTotal: number;
  wasteTokensTotal: number;
  worstOffenders: Array<{
    selfRedundancy: number;
    stepIndex: number;
    structuralNoiseRatio: number;
    tokens: number;
    tool: string;
  }>;
}

export function rollupOperation(snapshot: ExecutionSnapshot): OpToolFeedbackRollup {
  const results = collectToolResults(snapshot);
  const tokens = results.map((r) => r.tokens).sort((a, b) => a - b);
  const errors = results.filter((r) => r.isError);
  const offenders = [...results]
    .sort((a, b) => estWasteTokens(b) - estWasteTokens(a))
    .slice(0, 3)
    .map((r) => ({
      selfRedundancy: r.selfRedundancy,
      stepIndex: r.stepIndex,
      structuralNoiseRatio: r.structuralNoiseRatio,
      tokens: r.tokens,
      tool: r.tool,
    }));

  return {
    errorResultCount: errors.length,
    errorResultTokens: errors.reduce((s, r) => s + r.tokens, 0),
    operationId: snapshot.operationId,
    resultCount: results.length,
    selfRedundancyMax: results.reduce((m, r) => Math.max(m, r.selfRedundancy), 0),
    structuralNoiseAvg: results.length
      ? results.reduce((s, r) => s + r.structuralNoiseRatio, 0) / results.length
      : 0,
    tokensMax: percentile(tokens, 100),
    tokensP50: percentile(tokens, 50),
    tokensP90: percentile(tokens, 90),
    tokensP99: percentile(tokens, 99),
    tokensTotal: tokens.reduce((s, t) => s + t, 0),
    wasteTokensTotal: results.reduce((s, r) => s + estWasteTokens(r), 0),
    worstOffenders: offenders,
  };
}

/** Per-tool aggregate across a corpus — drives the dirty leaderboard. */
export interface ToolAggregate {
  calls: number;
  errRate: number;
  errTokens: number;
  noiseAvg: number;
  redundAvg: number;
  tokensP99: number;
  tokensTotal: number;
  tool: string;
  wasteTokens: number;
}

export interface CorpusReport {
  buckets: Array<{ count: number; label: string; tokens: number; upper: number }>;
  leaderboard: ToolAggregate[];
  ops: number;
  resultCount: number;
  tokensTotal: number;
  wasteTokensTotal: number;
}

const HIST_BUCKETS = [128, 512, 2048, 8192, 32_768, Infinity];

export function buildCorpusReport(perResult: ToolResultMetrics[], ops: number): CorpusReport {
  // histogram
  const buckets = HIST_BUCKETS.map((upper, i) => {
    const lower = i === 0 ? 0 : HIST_BUCKETS[i - 1];
    const label = upper === Infinity ? `≥${lower}` : `<${upper}`;
    return { count: 0, label, tokens: 0, upper };
  });
  for (const r of perResult) {
    const b = buckets.find((x) => r.tokens < x.upper) ?? buckets.at(-1);
    if (!b) continue;
    b.count += 1;
    b.tokens += r.tokens;
  }

  // per-tool aggregate
  const byTool = new Map<string, ToolResultMetrics[]>();
  for (const r of perResult) {
    const arr = byTool.get(r.tool) ?? [];
    arr.push(r);
    byTool.set(r.tool, arr);
  }
  const leaderboard: ToolAggregate[] = [...byTool.entries()]
    .map(([tool, rs]) => {
      const toks = rs.map((r) => r.tokens).sort((a, b) => a - b);
      const errs = rs.filter((r) => r.isError);
      return {
        calls: rs.length,
        errRate: errs.length / rs.length,
        errTokens: errs.reduce((s, r) => s + r.tokens, 0),
        noiseAvg: rs.reduce((s, r) => s + r.structuralNoiseRatio, 0) / rs.length,
        redundAvg: rs.reduce((s, r) => s + r.selfRedundancy, 0) / rs.length,
        tokensP99: percentile(toks, 99),
        tokensTotal: toks.reduce((s, t) => s + t, 0),
        tool,
        wasteTokens: rs.reduce((s, r) => s + estWasteTokens(r), 0),
      };
    })
    .sort((a, b) => b.wasteTokens - a.wasteTokens);

  return {
    buckets,
    leaderboard,
    ops,
    resultCount: perResult.length,
    tokensTotal: perResult.reduce((s, r) => s + r.tokens, 0),
    wasteTokensTotal: perResult.reduce((s, r) => s + estWasteTokens(r), 0),
  };
}
