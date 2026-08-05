import { encode } from 'gpt-tokenizer';

import type { ExecutionSnapshot, StepSnapshot } from '../types';
import { analyzeToolResult } from './toolFeedback';

/**
 * Context Lint — deterministic (no-LLM) rules over the *assembled LLM payload* of an
 * operation, the way ESLint works over source files. Each finding names a rule, the
 * offending step/message, and the tokens it wastes, so violations can be ranked by
 * token-weighted cost and traced back to the harness component that owns the fix
 * (tool formatter / tool gating / system-prompt template / history compression).
 *
 * The payload source is `steps[].contextEngine.output` — the exact messages array the
 * Context Engine handed to the model. Snapshots that predate the CE field fall back to
 * the legacy `messages` chain, with `payloadSource: 'legacy'` marking lower fidelity.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LintSeverity = 'error' | 'warn';

export interface LintFinding {
  detail: string;
  messageIndex?: number;
  rule: string;
  severity: LintSeverity;
  stepIndex: number;
  tool?: string;
  /** Tokens implicated by this finding — the waste weight used for ranking. */
  wasteTokens: number;
}

/** Flat per-op feature vector — the candidate rollup shape for `agent_operations`. */
export interface ContextLintFeatures {
  assistantTokens: number;
  /** Share of final-payload chars covered by shingles that occur in ≥2 messages. */
  dupShare: number;
  errorResultCount: number;
  errorResultTokens: number;
  /** Tokens of the largest payload actually sent to the model (last call_llm step). */
  finalPayloadTokens: number;
  findingsErrorCount: number;
  findingsWarnCount: number;
  lintScore: number;
  llmSteps: number;
  operationId: string;
  orphanToolCalls: number;
  orphanToolResults: number;
  payloadMessages: number;
  payloadSource: 'ce' | 'legacy' | 'none';
  selfRedundancyMax: number;
  structuralNoiseMax: number;
  systemShare: number;
  systemTokens: number;
  toolMsgShare: number;
  toolMsgTokens: number;
  toolResultCount: number;
  toolResultMaxTokens: number;
  toolsCalled: number;
  toolsOffered: number;
  toolUtilization: number;
  totalSteps: number;
  userTokens: number;
  /** Sum of finding wasteTokens, deduped per message. */
  wasteTokens: number;
}

export interface ContextLintResult {
  features: ContextLintFeatures;
  findings: LintFinding[];
}

// ---------------------------------------------------------------------------
// Thresholds (calibrated on the 2026-07 651-op stratified corpus)
// ---------------------------------------------------------------------------

const OVERSIZED_WARN_TOKENS = 4000;
const OVERSIZED_ERROR_TOKENS = 12_000;
const ERROR_RESULT_WARN_TOKENS = 500;
const ERROR_RESULT_ERROR_TOKENS = 2000;
const REPETITION_MIN_TOKENS = 1000;
const REPETITION_RATIO = 0.3;
const NOISE_MIN_TOKENS = 1000;
const NOISE_RATIO = 0.25;
const SYSTEM_WARN_TOKENS = 24_000;
const SYSTEM_ERROR_TOKENS = 40_000;
const TOOL_BLOAT_MIN_OFFERED = 40;
const TOOL_BLOAT_MAX_UTILIZATION = 0.15;
const DUP_WARN_SHARE = 0.05;
const DUP_ERROR_SHARE = 0.15;
const TRUNCATION_MARKER_RE =
  /truncat|已截断|省略|omitted|clipped|\.\.\.\s*\(\d+\s*more|<more|remaining\s+\d+/i;

// ---------------------------------------------------------------------------
// Payload reconstruction
// ---------------------------------------------------------------------------

interface PayloadMessage {
  content?: unknown;
  name?: string;
  reasoning?: string;
  role: string;
  tool_call_id?: string;
  tool_calls?: Array<{ function?: { arguments?: string; name?: string }; id?: string }>;
}

function contentText(m: PayloadMessage): string {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) =>
        typeof p === 'string' ? p : typeof (p as any)?.text === 'string' ? (p as any).text : '',
      )
      .join('\n');
  }
  return '';
}

/**
 * Resolve the messages array the model saw at each `call_llm` step.
 * `contextEngine.output` uses a changed-fields delta: reuse the last seen value when a
 * step's CE entry omits it.
 */
export function resolvePayloads(snapshot: ExecutionSnapshot): {
  payloadSource: ContextLintFeatures['payloadSource'];
  payloads: Array<{ messages: PayloadMessage[]; stepIndex: number }>;
} {
  let current: PayloadMessage[] | undefined;
  const payloads: Array<{ messages: PayloadMessage[]; stepIndex: number }> = [];
  for (const step of snapshot.steps) {
    const out = step.contextEngine?.output;
    if (Array.isArray(out)) current = out as PayloadMessage[];
    if (step.stepType === 'call_llm' && current)
      payloads.push({ messages: current, stepIndex: step.stepIndex });
  }
  if (payloads.length > 0) return { payloadSource: 'ce', payloads };

  // Legacy fallback: full messages arrays recorded before the CE field existed.
  let legacy: PayloadMessage[] | undefined;
  const legacyPayloads: Array<{ messages: PayloadMessage[]; stepIndex: number }> = [];
  for (const step of snapshot.steps) {
    const msgs = (step as StepSnapshot).messages;
    if (Array.isArray(msgs) && msgs.length > 0) legacy = msgs as PayloadMessage[];
    if (step.stepType === 'call_llm' && legacy)
      legacyPayloads.push({ messages: legacy, stepIndex: step.stepIndex });
  }
  return legacyPayloads.length > 0
    ? { payloadSource: 'legacy', payloads: legacyPayloads }
    : { payloadSource: 'none', payloads: [] };
}

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

/**
 * Char share of content whose word-level shingles also occur in another message.
 * Word shingles (vs fixed char windows) keep detection alignment-free: a block quoted
 * behind a prefix or reflowed across lines still matches its original.
 */
const DUP_WORDS = 16;
// owner index at stride 1 so a copy at ANY word offset (or periodic content) still matches
const DUP_OWNER_STRIDE = 1;
function crossMessageDupShare(texts: string[]): number {
  const owner = new Map<string, number>();
  const words = texts.map((t) => t.split(/\s+/).filter(Boolean));
  let totalChars = 0;
  for (const [mi, ws] of words.entries()) {
    totalChars += texts[mi].length;
    for (let i = 0; i + DUP_WORDS <= ws.length; i += DUP_OWNER_STRIDE) {
      const sh = ws.slice(i, i + DUP_WORDS).join(' ');
      if (!owner.has(sh)) owner.set(sh, mi);
    }
  }
  if (totalChars === 0) return 0;
  let dup = 0;
  for (const [mi, ws] of words.entries()) {
    for (let i = 0; i + DUP_WORDS <= ws.length; i += DUP_WORDS) {
      const sh = ws.slice(i, i + DUP_WORDS).join(' ');
      const seen = owner.get(sh);
      if (seen !== undefined && seen !== mi) dup += sh.length;
    }
  }
  return Math.min(1, dup / totalChars);
}

function distinctToolNames(snapshot: ExecutionSnapshot): Set<string> {
  const called = new Set<string>();
  for (const step of snapshot.steps) {
    for (const c of step.toolsCalling ?? []) {
      if (c?.apiName) called.add(`${c.identifier ?? '?'}/${c.apiName}`);
    }
  }
  return called;
}

function toolsOfferedCount(snapshot: ExecutionSnapshot): number {
  for (const step of snapshot.steps) {
    const payload = (step.context?.payload ?? {}) as { tools?: unknown[] };
    if (Array.isArray(payload.tools)) return payload.tools.length;
    const baseline = step.toolsetBaseline as { tools?: unknown[] } | undefined;
    if (Array.isArray(baseline?.tools)) return baseline.tools.length;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

export function lintSnapshot(snapshot: ExecutionSnapshot): ContextLintResult {
  const findings: LintFinding[] = [];
  const { payloadSource, payloads } = resolvePayloads(snapshot);
  const final = payloads.at(-1);
  const finalMessages = final?.messages ?? [];
  const finalStep = final?.stepIndex ?? 0;

  // --- final payload composition ---
  const perMessageTokens = finalMessages.map((m) => {
    const text = contentText(m) + (m.tool_calls ? JSON.stringify(m.tool_calls) : '');
    return text ? encode(text).length : 0;
  });
  const finalPayloadTokens = perMessageTokens.reduce((s, t) => s + t, 0);
  const roleTokens = (role: string) =>
    finalMessages.reduce((s, m, i) => (m.role === role ? s + perMessageTokens[i] : s), 0);
  const systemTokens = roleTokens('system');
  const toolMsgTokens = roleTokens('tool');
  const assistantTokens = roleTokens('assistant');
  const userTokens = roleTokens('user');

  const wastedByMessage = new Map<number, number>();
  const noteWaste = (messageIndex: number | undefined, tokens: number) => {
    if (messageIndex === undefined) return;
    wastedByMessage.set(messageIndex, Math.max(wastedByMessage.get(messageIndex) ?? 0, tokens));
  };

  // --- rule: system-prompt-bloat ---
  if (systemTokens >= SYSTEM_WARN_TOKENS) {
    const sysIdx = finalMessages.findIndex((m) => m.role === 'system');
    findings.push({
      detail: `system prompt is ${systemTokens} tokens (${Math.round((systemTokens / Math.max(1, finalPayloadTokens)) * 100)}% of payload)`,
      messageIndex: sysIdx,
      rule: 'system-prompt-bloat',
      severity: systemTokens >= SYSTEM_ERROR_TOKENS ? 'error' : 'warn',
      stepIndex: finalStep,
      wasteTokens: systemTokens - SYSTEM_WARN_TOKENS,
    });
    noteWaste(sysIdx, systemTokens - SYSTEM_WARN_TOKENS);
  }

  // --- per tool-result rules (scored on raw toolsResult, attributed to payload when present) ---
  let toolResultCount = 0;
  let toolResultMaxTokens = 0;
  let errorResultCount = 0;
  let errorResultTokens = 0;
  let selfRedundancyMax = 0;
  let structuralNoiseMax = 0;
  for (const step of snapshot.steps) {
    for (const r of step.toolsResult ?? []) {
      if (typeof r?.output !== 'string') continue;
      toolResultCount += 1;
      const m = analyzeToolResult(r.output, r.isSuccess);
      const tool = `${r.identifier ?? '?'}/${r.apiName ?? '?'}`;
      toolResultMaxTokens = Math.max(toolResultMaxTokens, m.tokens);
      selfRedundancyMax = Math.max(selfRedundancyMax, m.selfRedundancy);
      structuralNoiseMax = Math.max(structuralNoiseMax, m.structuralNoiseRatio);
      if (m.isError) {
        errorResultCount += 1;
        errorResultTokens += m.tokens;
      }

      if (m.tokens >= OVERSIZED_WARN_TOKENS && !TRUNCATION_MARKER_RE.test(r.output)) {
        findings.push({
          detail: `${m.tokens} tokens with no truncation marker`,
          rule: 'oversized-tool-result',
          severity: m.tokens >= OVERSIZED_ERROR_TOKENS ? 'error' : 'warn',
          stepIndex: step.stepIndex,
          tool,
          wasteTokens: m.tokens - OVERSIZED_WARN_TOKENS,
        });
      }
      if (m.isError && m.tokens >= ERROR_RESULT_WARN_TOKENS) {
        findings.push({
          detail: `error result is ${m.tokens} tokens — failures should be one line`,
          rule: 'error-result-oversized',
          severity: m.tokens >= ERROR_RESULT_ERROR_TOKENS ? 'error' : 'warn',
          stepIndex: step.stepIndex,
          tool,
          wasteTokens: m.tokens - ERROR_RESULT_WARN_TOKENS,
        });
      }
      if (m.selfRedundancy >= REPETITION_RATIO && m.tokens >= REPETITION_MIN_TOKENS) {
        findings.push({
          detail: `${Math.round(m.selfRedundancy * 100)}% of the content is exact repeats`,
          rule: 'degenerate-repetition',
          severity: 'error',
          stepIndex: step.stepIndex,
          tool,
          wasteTokens: Math.round(m.tokens * m.selfRedundancy),
        });
      }
      if (m.structuralNoiseRatio >= NOISE_RATIO && m.tokens >= NOISE_MIN_TOKENS) {
        findings.push({
          detail: `${Math.round(m.structuralNoiseRatio * 100)}% markup-attribute noise (id/class/data-*)`,
          rule: 'structural-noise',
          severity: 'warn',
          stepIndex: step.stepIndex,
          tool,
          wasteTokens: Math.round(m.tokens * m.structuralNoiseRatio),
        });
      }
    }
  }

  // --- rule: duplicate-context-block ---
  const dupShare = crossMessageDupShare(finalMessages.map((m) => contentText(m)));
  if (dupShare >= DUP_WARN_SHARE && finalPayloadTokens > 0) {
    findings.push({
      detail: `${Math.round(dupShare * 100)}% of payload chars appear in more than one message`,
      rule: 'duplicate-context-block',
      severity: dupShare >= DUP_ERROR_SHARE ? 'error' : 'warn',
      stepIndex: finalStep,
      wasteTokens: Math.round(finalPayloadTokens * dupShare),
    });
  }

  // --- rule: orphan tool linkage (structure) ---
  let orphanToolCalls = 0;
  let orphanToolResults = 0;
  if (finalMessages.length > 0) {
    const callIds = new Set<string>();
    for (const m of finalMessages) {
      for (const c of m.tool_calls ?? []) if (c?.id) callIds.add(c.id);
    }
    const resultIds = new Set<string>();
    for (const [i, m] of finalMessages.entries()) {
      if (m.role !== 'tool') continue;
      if (m.tool_call_id) resultIds.add(m.tool_call_id);
      if (!m.tool_call_id || !callIds.has(m.tool_call_id)) {
        orphanToolResults += 1;
        findings.push({
          detail: `tool message [${i}] has no matching assistant tool_call (${m.tool_call_id ?? 'missing id'})`,
          messageIndex: i,
          rule: 'orphan-tool-result',
          severity: 'error',
          stepIndex: finalStep,
          wasteTokens: perMessageTokens[i] ?? 0,
        });
        noteWaste(i, perMessageTokens[i] ?? 0);
      }
    }
    for (const id of callIds) if (!resultIds.has(id)) orphanToolCalls += 1;
    if (orphanToolCalls > 0) {
      findings.push({
        detail: `${orphanToolCalls} assistant tool_call(s) have no tool result message`,
        rule: 'orphan-tool-call',
        severity: 'error',
        stepIndex: finalStep,
        wasteTokens: 0,
      });
    }
  }

  // --- rule: tool-def-bloat ---
  const toolsOffered = toolsOfferedCount(snapshot);
  const toolsCalled = distinctToolNames(snapshot).size;
  const toolUtilization = toolsOffered > 0 ? toolsCalled / toolsOffered : 1;
  if (toolsOffered >= TOOL_BLOAT_MIN_OFFERED && toolUtilization < TOOL_BLOAT_MAX_UTILIZATION) {
    findings.push({
      detail: `${toolsOffered} tools offered, ${toolsCalled} called (${Math.round(toolUtilization * 100)}% utilization)`,
      rule: 'tool-def-bloat',
      severity: 'warn',
      stepIndex: 0,
      wasteTokens: 0, // definitions live outside the messages payload; tracked as a count feature
    });
  }

  // --- score: share of the final payload not implicated by any finding ---
  const messageWaste = [...wastedByMessage.values()].reduce((s, t) => s + t, 0);
  const resultWaste = findings
    .filter((f) => f.messageIndex === undefined)
    .reduce((s, f) => s + f.wasteTokens, 0);
  const wasteTokens = messageWaste + resultWaste;
  const lintScore =
    finalPayloadTokens > 0
      ? Math.max(0, Math.round(100 * (1 - wasteTokens / finalPayloadTokens)))
      : findings.length > 0
        ? 0
        : 100;

  return {
    features: {
      assistantTokens,
      dupShare: Number(dupShare.toFixed(4)),
      errorResultCount,
      errorResultTokens,
      findingsErrorCount: findings.filter((f) => f.severity === 'error').length,
      findingsWarnCount: findings.filter((f) => f.severity === 'warn').length,
      finalPayloadTokens,
      lintScore,
      llmSteps: snapshot.steps.filter((s) => s.stepType === 'call_llm').length,
      operationId: snapshot.operationId,
      orphanToolCalls,
      orphanToolResults,
      payloadMessages: finalMessages.length,
      payloadSource,
      selfRedundancyMax: Number(selfRedundancyMax.toFixed(4)),
      structuralNoiseMax: Number(structuralNoiseMax.toFixed(4)),
      systemShare:
        finalPayloadTokens > 0 ? Number((systemTokens / finalPayloadTokens).toFixed(4)) : 0,
      systemTokens,
      toolMsgShare:
        finalPayloadTokens > 0 ? Number((toolMsgTokens / finalPayloadTokens).toFixed(4)) : 0,
      toolMsgTokens,
      toolResultCount,
      toolResultMaxTokens,
      toolUtilization: Number(toolUtilization.toFixed(4)),
      toolsCalled,
      toolsOffered,
      totalSteps: snapshot.steps.length,
      userTokens,
      wasteTokens,
    },
    findings,
  };
}
