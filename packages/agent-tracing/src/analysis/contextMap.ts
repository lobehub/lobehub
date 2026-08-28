import { encode } from 'gpt-tokenizer';

import type { ExecutionSnapshot } from '../types';
import { reconstructMessages } from '../utils/reconstruct';
import { contentText, type PayloadMessage, resolvePayloads } from './contextLint';

/**
 * Context Map — the *shape* of every context window an operation sent to the model,
 * one row per `call_llm` step. Where `contextLint` collapses the final payload into
 * scalar shares, this keeps both structural axes:
 *
 * - horizontal: each message split into typed segments (system / injected / user /
 *   reasoning / tool_call / tool_result), width proportional to tokens, against the
 *   model's full context window as the track.
 * - vertical: how each call differs from the previous one — the longest identical
 *   message prefix is what a provider's prefix cache can reuse, so the first message
 *   that mutates marks where caching breaks and everything after it gets re-processed.
 *
 * The second axis is what makes re-materialized context visible: a 2k injected block
 * carrying a relative timestamp mutates every call and invalidates the whole tail
 * behind it, which no single-payload rule can see.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentKind =
  'system' | 'injected' | 'user' | 'reasoning' | 'assistant' | 'tool_call' | 'tool_result';

/** Payload message roles — the wrapper a segment belongs to. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ContextSegment {
  kind: SegmentKind;
  /** Short human label: tool name, injected block tag, or the role. */
  label: string;
  /** Index of the owning message in the payload — several segments may share one. */
  messageIndex: number;
  preview: string;
  /** Role of the owning message — segments sharing a messageIndex share a role. */
  role: MessageRole;
  tokens: number;
  /** Identical to the segment at the same position in the previous call's payload. */
  unchanged: boolean;
}

export interface ContextCall {
  /** Message index where the payload first diverges from the previous call. */
  breakMessageIndex?: number;
  /** Why the prefix broke, e.g. `injected block <agent_documents_index> mutated`. */
  breakReason?: string;
  /** Tokens in the identical leading messages a prefix cache could reuse. */
  cachedTokens: number;
  callIndex: number;
  /** Tokens the model must re-process because the prefix broke before them. */
  reprocessedTokens: number;
  segments: ContextSegment[];
  stablePrefixMessages: number;
  stepIndex: number;
  totalTokens: number;
  /**
   * Tokens that were byte-identical to the previous call yet sit behind the break —
   * they would have been cache hits had the earlier message not mutated.
   */
  wastedTokens: number;
}

export interface ContextMapSummary {
  /** Calls whose prefix broke before the payload's own growth point. */
  brokenPrefixCalls: number;
  /**
   * Composition of the final call's context window. Summing every call instead would
   * count the same system prompt once per call and inflate whatever repeats most.
   */
  kindTokens: Record<SegmentKind, number>;
  llmCalls: number;
  maxCallTokens: number;
  totalReprocessedTokens: number;
  totalWastedTokens: number;
}

export interface ContextMap {
  calls: ContextCall[];
  contextWindowTokens?: number;
  model?: string;
  operationId: string;
  payloadSource: 'ce' | 'legacy' | 'none';
  provider?: string;
  summary: ContextMapSummary;
}

export interface BuildContextMapOptions {
  /** Model context window used as the track width; omit to scale to the largest call. */
  contextWindowTokens?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KINDS: SegmentKind[] = [
  'system',
  'injected',
  'user',
  'reasoning',
  'assistant',
  'tool_call',
  'tool_result',
];

const PREVIEW_LEN = 120;

const preview = (text: string) => text.replaceAll(/\s+/g, ' ').trim().slice(0, PREVIEW_LEN);

/** Leading XML-ish tag of an injected block, e.g. `<agent_documents_index>`. */
function blockTag(text: string): string | undefined {
  const match = /^\s*<([\w-]+)[\s>]/.exec(text);
  return match ? `<${match[1]}>` : undefined;
}

const KIND_NOUN: Record<SegmentKind, string> = {
  assistant: 'assistant message',
  injected: 'injected block',
  reasoning: 'reasoning',
  system: 'system prompt',
  tool_call: 'tool call',
  tool_result: 'tool result',
  user: 'user message',
};

/** Break reasons across an operation, ranked by unchanged tokens then by frequency. */
export function collectBreakReasons(
  map: ContextMap,
): Array<{ count: number; reason: string; wasted: number }> {
  const byReason = new Map<string, { count: number; wasted: number }>();
  for (const call of map.calls) {
    if (!call.breakReason) continue;
    const entry = byReason.get(call.breakReason) ?? { count: 0, wasted: 0 };
    byReason.set(call.breakReason, {
      count: entry.count + 1,
      wasted: entry.wasted + call.wastedTokens,
    });
  }
  return [...byReason]
    .map(([reason, entry]) => ({ reason, ...entry }))
    .sort((a, b) => b.wasted - a.wasted || b.count - a.count);
}

/** Human phrase for a segment, e.g. `injected block <agent_documents_index>`. */
export function describeSegment(segment: ContextSegment): string {
  const noun = KIND_NOUN[segment.kind];
  return segment.label && segment.label !== segment.kind ? `${noun} ${segment.label}` : noun;
}

/** Reasoning is a string on most providers and a `{ content }` object on some. */
function reasoningText(m: PayloadMessage): string {
  const raw = m.reasoning ?? m.reasoning_content;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const content = (raw as { content?: unknown }).content;
    return typeof content === 'string' ? content : JSON.stringify(raw);
  }
  return '';
}

/** Full serialized form of a message — the unit a prefix cache matches on. */
function messageSignature(m: PayloadMessage): string {
  return [
    m.role,
    contentText(m),
    reasoningText(m),
    m.tool_calls ? JSON.stringify(m.tool_calls) : '',
    m.tool_call_id ?? '',
  ].join('\\0');
}

/**
 * Content of the DB messages behind a step, normalized for matching. A payload message
 * that has no counterpart here was synthesized by the Context Engine — an injection.
 */
function dbMessageKeys(snapshot: ExecutionSnapshot, stepIndex: number): Set<string> {
  const keys = new Set<string>();
  const step = snapshot.steps.find((s) => s.stepIndex === stepIndex);
  const messages =
    step?.messages ?? (step ? reconstructMessages(snapshot.steps, stepIndex).messages : []);
  for (const m of messages ?? []) {
    const text = contentText(m as PayloadMessage);
    if (text) keys.add(preview(text));
  }
  return keys;
}

/** Anything that is not a known role is treated as an assistant turn. */
function messageRole(m: PayloadMessage): MessageRole {
  return m.role === 'system' || m.role === 'user' || m.role === 'tool' ? m.role : 'assistant';
}

function splitMessage(
  m: PayloadMessage,
  messageIndex: number,
  isInjected: boolean,
  countTokens: (text: string) => number,
): ContextSegment[] {
  const role = messageRole(m);
  const segment = (kind: SegmentKind, label: string, text: string): ContextSegment | undefined => {
    const tokens = countTokens(text);
    return tokens > 0
      ? { kind, label, messageIndex, preview: preview(text), role, tokens, unchanged: false }
      : undefined;
  };

  const text = contentText(m);

  if (m.role === 'system')
    return [segment('system', 'system', text)].filter(Boolean) as ContextSegment[];

  if (m.role === 'tool') {
    const label = m.name ?? 'tool result';
    return [segment('tool_result', label, text)].filter(Boolean) as ContextSegment[];
  }

  if (m.role === 'user') {
    const kind: SegmentKind = isInjected ? 'injected' : 'user';
    const label = (isInjected && blockTag(text)) || (isInjected ? 'injected' : 'user');
    return [segment(kind, label, text)].filter(Boolean) as ContextSegment[];
  }

  // assistant — reasoning, content and tool calls are distinct kinds of context
  const toolNames = (m.tool_calls ?? [])
    .map((c) => c.function?.name)
    .filter(Boolean)
    .join(', ');
  return [
    segment('reasoning', 'reasoning', reasoningText(m)),
    segment('assistant', 'assistant', text),
    segment(
      'tool_call',
      toolNames || 'tool call',
      m.tool_calls ? JSON.stringify(m.tool_calls) : '',
    ),
  ].filter(Boolean) as ContextSegment[];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildContextMap(
  snapshot: ExecutionSnapshot,
  options: BuildContextMapOptions = {},
): ContextMap {
  const tokenCache = new Map<string, number>();
  const countTokens = (text: string): number => {
    if (!text || typeof text !== 'string') return 0;
    const hit = tokenCache.get(text);
    if (hit !== undefined) return hit;
    const tokens = encode(text).length;
    tokenCache.set(text, tokens);
    return tokens;
  };

  const { payloadSource, payloads } = resolvePayloads(snapshot);
  const calls: ContextCall[] = [];

  let prevSignatures: string[] = [];
  let prevTokens: number[] = [];
  let prevStepIndex = -1;

  for (const [callIndex, payload] of payloads.entries()) {
    const dbKeys = dbMessageKeys(snapshot, payload.stepIndex);
    const signatures = payload.messages.map((m) => messageSignature(m));
    const messageTokens: number[] = [];
    const segments: ContextSegment[] = [];

    for (const [messageIndex, m] of payload.messages.entries()) {
      // A user message the CE produced rather than the user — env blocks, doc indexes, memory.
      const isInjected = m.role === 'user' && !dbKeys.has(preview(contentText(m)));
      const parts = splitMessage(m, messageIndex, isInjected, countTokens);
      messageTokens.push(parts.reduce((sum, p) => sum + p.tokens, 0));
      segments.push(...parts);
    }

    let stablePrefixMessages = 0;
    while (
      stablePrefixMessages < Math.min(prevSignatures.length, signatures.length) &&
      prevSignatures[stablePrefixMessages] === signatures[stablePrefixMessages]
    ) {
      stablePrefixMessages += 1;
    }

    for (const segment of segments) {
      segment.unchanged = segment.messageIndex < stablePrefixMessages;
    }

    const totalTokens = messageTokens.reduce((sum, t) => sum + t, 0);
    const cachedTokens = messageTokens
      .slice(0, stablePrefixMessages)
      .reduce((sum, t) => sum + t, 0);

    // A break only exists when the previous payload's own messages stopped matching;
    // a payload that merely grew at the end keeps a fully reusable prefix.
    const broke = callIndex > 0 && stablePrefixMessages < prevSignatures.length;
    let breakReason: string | undefined;
    if (broke) {
      // A compression reset rewrites the history on purpose — not a cache fault to fix.
      // The reset lands in the *next* payload, so the window starts at the previous call.
      const compressed = snapshot.steps.some(
        (s) =>
          s.isCompressionReset && s.stepIndex <= payload.stepIndex && s.stepIndex >= prevStepIndex,
      );
      const culprit = segments.find((s) => s.messageIndex === stablePrefixMessages);
      const resized =
        (prevTokens[stablePrefixMessages] ?? 0) !== (messageTokens[stablePrefixMessages] ?? 0);
      breakReason = compressed
        ? 'context compression reset'
        : culprit
          ? `${describeSegment(culprit)} ${resized ? 'resized' : 'mutated'}`
          : 'payload truncated';
    }

    // Tokens that survived unchanged but sit behind the break — cacheable in principle.
    let wastedTokens = 0;
    if (broke) {
      for (
        let i = stablePrefixMessages;
        i < Math.min(prevSignatures.length, signatures.length);
        i++
      ) {
        if (prevSignatures[i] === signatures[i]) wastedTokens += messageTokens[i];
      }
    }

    calls.push({
      breakMessageIndex: broke ? stablePrefixMessages : undefined,
      breakReason,
      cachedTokens,
      callIndex,
      reprocessedTokens: totalTokens - cachedTokens,
      segments,
      stablePrefixMessages,
      stepIndex: payload.stepIndex,
      totalTokens,
      wastedTokens,
    });

    prevSignatures = signatures;
    prevTokens = messageTokens;
    prevStepIndex = payload.stepIndex;
  }

  const kindTokens = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<SegmentKind, number>;
  for (const segment of calls.at(-1)?.segments ?? []) kindTokens[segment.kind] += segment.tokens;

  return {
    calls,
    contextWindowTokens: options.contextWindowTokens,
    model: snapshot.model,
    operationId: snapshot.operationId,
    payloadSource,
    provider: snapshot.provider,
    summary: {
      brokenPrefixCalls: calls.filter((c) => c.breakMessageIndex !== undefined).length,
      kindTokens,
      llmCalls: calls.length,
      maxCallTokens: calls.reduce((max, c) => Math.max(max, c.totalTokens), 0),
      totalReprocessedTokens: calls.reduce((sum, c) => sum + c.reprocessedTokens, 0),
      totalWastedTokens: calls.reduce((sum, c) => sum + c.wastedTokens, 0),
    },
  };
}
