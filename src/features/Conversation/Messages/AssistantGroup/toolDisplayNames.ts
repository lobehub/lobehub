import { type ChatToolPayloadWithResult } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';
import { type AssistantContentBlock } from '@/types/index';

import {
  DURATION_SECONDS_PER_MINUTE,
  POST_TOOL_ANSWER_DOUBLE_NEWLINE_SCORE,
  POST_TOOL_ANSWER_LENGTH_LONG_MIN_CHARS,
  POST_TOOL_ANSWER_LENGTH_LONG_SCORE,
  POST_TOOL_ANSWER_LENGTH_MEDIUM_MIN_CHARS,
  POST_TOOL_ANSWER_MARKDOWN_STRUCTURE_SCORE,
  POST_TOOL_ANSWER_MEDIUM_TEXT_SCORE,
  POST_TOOL_ANSWER_MULTI_LINE_MIN_COUNT,
  POST_TOOL_ANSWER_MULTI_LINE_SCORE,
  POST_TOOL_ANSWER_PUNCT_MIN_COUNT,
  POST_TOOL_ANSWER_PUNCT_SCORE,
  POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD,
  TIME_MS_PER_SECOND,
  TOOL_API_DISPLAY_NAMES,
  TOOL_FIRST_DETAIL_MAX_CHARS,
  TOOL_HEADLINE_DETAIL_MAX_CHARS,
  TOOL_HEADLINE_DETAIL_TRUNCATE_LEN,
  TOOL_HEADLINE_TRUNCATION_SUFFIX,
  WORKFLOW_MARKDOWN_HEADING_MAX_LEVEL,
  WORKFLOW_PROSE_HEADLINE_MAX_CHARS,
  WORKFLOW_PROSE_LIST_MARKER_MAX_TAIL_WORD_CHARS,
  WORKFLOW_PROSE_MIN_CHARS,
  WORKFLOW_PROSE_SOURCE_MIN_CHARS,
  WORKFLOW_TRUNCATE_WORD_BOUNDARY_MIN_RATIO,
} from './constants';

export const areWorkflowToolsComplete = (tools: ChatToolPayloadWithResult[]): boolean => {
  const collapsible = tools.filter((t) => t.intervention?.status !== 'pending');
  if (collapsible.length === 0) return false;
  return collapsible.every((t) => t.result != null && t.result.content !== LOADING_FLAT);
};

/** Heuristic: prose-only block after last tool looks like a long deliverable (not a one-line step). */
export const scorePostToolBlockAsFinalAnswer = (block: AssistantContentBlock): number => {
  if (block.tools && block.tools.length > 0) return 0;
  const raw = (block.content ?? '').trim();
  if (!raw || raw === LOADING_FLAT) return 0;

  let score = 0;
  const compact = raw.replaceAll(/\s+/g, ' ');
  if (compact.length >= POST_TOOL_ANSWER_LENGTH_LONG_MIN_CHARS)
    score += POST_TOOL_ANSWER_LENGTH_LONG_SCORE;
  else if (compact.length >= POST_TOOL_ANSWER_LENGTH_MEDIUM_MIN_CHARS)
    score += POST_TOOL_ANSWER_MEDIUM_TEXT_SCORE;

  if (raw.includes('\n\n')) score += POST_TOOL_ANSWER_DOUBLE_NEWLINE_SCORE;
  else if (raw.split('\n').filter((l) => l.trim()).length >= POST_TOOL_ANSWER_MULTI_LINE_MIN_COUNT)
    score += POST_TOOL_ANSWER_MULTI_LINE_SCORE;

  if (
    new RegExp(`^#{1,${WORKFLOW_MARKDOWN_HEADING_MAX_LEVEL}}\\s`, 'm').test(raw) ||
    /^\s*[-*]\s+\S/m.test(raw)
  )
    score += POST_TOOL_ANSWER_MARKDOWN_STRUCTURE_SCORE;

  const punctCount = (compact.match(/[。！？.!?]/g) ?? []).length;
  if (punctCount >= POST_TOOL_ANSWER_PUNCT_MIN_COUNT) score += POST_TOOL_ANSWER_PUNCT_SCORE;

  return score;
};

/**
 * While generating, first index at or after {@param lastToolIndex} whose prose-only block scores
 * as final-answer-like. Tail from here stays out of the workflow fold. Returns null if tooling
 * reappears or nothing qualifies.
 */
export const getPostToolAnswerSplitIndex = (
  blocks: AssistantContentBlock[],
  lastToolIndex: number,
  toolsPhaseComplete: boolean,
  isGenerating: boolean,
): number | null => {
  if (!isGenerating || !toolsPhaseComplete || lastToolIndex < 0) return null;
  if (lastToolIndex >= blocks.length - 1) return null;

  for (let i = lastToolIndex + 1; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.tools && b.tools.length > 0) return null;
    if (scorePostToolBlockAsFinalAnswer(b) >= POST_TOOL_FINAL_ANSWER_SCORE_THRESHOLD) return i;
  }
  return null;
};

const toTitleCase = (apiName: string): string => {
  return apiName
    .replaceAll(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
};

export const getToolDisplayName = (apiName: string): string => {
  return TOOL_API_DISPLAY_NAMES[apiName] || toTitleCase(apiName);
};

export const getToolSummaryText = (tools: ChatToolPayloadWithResult[]): string => {
  const groups = new Map<string, number>();
  for (const tool of tools) {
    groups.set(tool.apiName, (groups.get(tool.apiName) || 0) + 1);
  }

  const parts: string[] = [];
  for (const [apiName, count] of groups) {
    const name = getToolDisplayName(apiName);
    if (count > 1) {
      parts.push(`${name} (${count})`);
    } else {
      parts.push(name);
    }
  }

  return parts.join(', ');
};

export const hasToolError = (tools: ChatToolPayloadWithResult[]): boolean => {
  return tools.some((t) => t.result?.error);
};

export const getToolFirstDetail = (tool: ChatToolPayloadWithResult): string => {
  try {
    const args = JSON.parse(tool.arguments || '{}');
    const values = Object.values(args);
    for (const val of values) {
      if (typeof val === 'string' && val.trim()) {
        return val.length > TOOL_FIRST_DETAIL_MAX_CHARS
          ? val.slice(0, TOOL_FIRST_DETAIL_MAX_CHARS) + TOOL_HEADLINE_TRUNCATION_SUFFIX
          : val;
      }
    }
  } catch {
    // arguments still streaming or invalid
  }
  return '';
};

/** Optional progress line from tool-runtime state (pluginState → result.state) or metadata */
interface WorkflowHeadlinePayload {
  metadata?: { workflow?: { stepMessage?: string } };
  state?: { workflowHeadline?: { stepMessage?: string } };
}

const getResultStepMessage = (tool: ChatToolPayloadWithResult): string => {
  const r = tool.result as WorkflowHeadlinePayload | null | undefined;
  if (!r) return '';
  const fromState = r.state?.workflowHeadline?.stepMessage?.trim();
  if (fromState) return fromState;
  return r.metadata?.workflow?.stepMessage?.trim() ?? '';
};

/** B — runtime stepMessage only (no args fallback). */
export const getExplicitStepHeadlineLine = (tool: ChatToolPayloadWithResult): string => {
  const step = getResultStepMessage(tool).trim();
  if (!step) return '';
  const label = getToolDisplayName(tool.apiName);
  const short =
    step.length > TOOL_HEADLINE_DETAIL_MAX_CHARS
      ? step.slice(0, TOOL_HEADLINE_DETAIL_TRUNCATE_LEN) + TOOL_HEADLINE_TRUNCATION_SUFFIX
      : step;
  return `${label}: ${short}`;
};

/** C — tool label + first string arg (no explicit step). */
export const getToolFallbackHeadlineLine = (tool: ChatToolPayloadWithResult): string => {
  const label = getToolDisplayName(tool.apiName);
  const fromArgs = getToolFirstDetail(tool).trim();
  if (fromArgs) {
    const short =
      fromArgs.length > TOOL_HEADLINE_DETAIL_MAX_CHARS
        ? fromArgs.slice(0, TOOL_HEADLINE_DETAIL_TRUNCATE_LEN) + TOOL_HEADLINE_TRUNCATION_SUFFIX
        : fromArgs;
    return `${label}: ${short}`;
  }
  return label;
};

/**
 * One-line status for a single tool: label + optional step / first string arg.
 * Prefer explicit stepMessage when backends populate workflowHeadline / metadata.workflow.
 */
export const getToolStepHeadlineLine = (tool: ChatToolPayloadWithResult): string => {
  const explicit = getExplicitStepHeadlineLine(tool);
  if (explicit) return explicit;
  return getToolFallbackHeadlineLine(tool);
};

const truncateDisplayAtWord = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > max * WORKFLOW_TRUNCATE_WORD_BOUNDARY_MIN_RATIO)
    return `${slice.slice(0, lastSpace)}${TOOL_HEADLINE_TRUNCATION_SUFFIX}`;
  return `${slice}${TOOL_HEADLINE_TRUNCATION_SUFFIX}`;
};

/** Han / full-width CJK punctuation — if present, prefer 。！？ only (ASCII . is not a sentence end). */
/** CJK Han block — prefer 。！？ sentence ends (see constants module comment). */
const hasCjkScript = (s: string): boolean => /[\u4E00-\u9FFF]/.test(s);

const firstSentenceEndCjk = (s: string): number => {
  const i = s.search(/[。！？]/);
  return i;
};

const isAlphanum = (c: string) => /[a-z\d]/i.test(c);

/** Latin-heavy: treat .!? as ends but skip dots inside tokens (Node.js, 3.14, …). */
const firstSentenceEndLatin = (s: string): number => {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '。' || ch === '！' || ch === '？') return i;
    if (ch === '!' || ch === '?') return i;
    if (ch === '.') {
      const prev = s[i - 1] ?? '';
      const next = s[i + 1] ?? '';
      if (isAlphanum(prev) && isAlphanum(next)) continue;
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      return i;
    }
  }
  return -1;
};

const stripLightMarkdownForHeadline = (md: string): string => {
  let s = md;
  s = s.replaceAll(/```[\s\S]*?```/g, ' ');
  s = s.replaceAll(/`([^`]+)`/g, '$1');
  s = s.replaceAll(/\*\*?|__/g, '');
  s = s.replaceAll(new RegExp(`^#{1,${WORKFLOW_MARKDOWN_HEADING_MAX_LEVEL}}\\s+`, 'gm'), '');
  s = s.replaceAll(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  return s;
};

/**
 * Deterministic one-line snippet from streamed assistant prose (A path).
 * Prefers a full sentence when punctuation exists; otherwise trims to max width.
 */
export const shapeProseForWorkflowHeadline = (source: string): string => {
  let s = stripLightMarkdownForHeadline(source);
  s = s.replaceAll(/\s+/g, ' ').trim();
  if (s.length < WORKFLOW_PROSE_MIN_CHARS) return '';
  if (new RegExp(`^[-*+]\\s*\\w{0,${WORKFLOW_PROSE_LIST_MARKER_MAX_TAIL_WORD_CHARS}}$`).test(s))
    return '';

  const endIdx = hasCjkScript(s) ? firstSentenceEndCjk(s) : firstSentenceEndLatin(s);
  if (endIdx >= 0) {
    const sentence = s.slice(0, endIdx + 1).trim();
    if (sentence.length >= WORKFLOW_PROSE_MIN_CHARS)
      return truncateDisplayAtWord(sentence, WORKFLOW_PROSE_HEADLINE_MAX_CHARS);
  }

  return truncateDisplayAtWord(s, WORKFLOW_PROSE_HEADLINE_MAX_CHARS);
};

/** Raw assistant `content` from the latest block that qualifies (scan from end). */
export const extractLatestProseHeadlineSource = (blocks: AssistantContentBlock[]): string => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const c = blocks[i]?.content?.trim() ?? '';
    if (!c || c === LOADING_FLAT) continue;
    if (c.length < WORKFLOW_PROSE_SOURCE_MIN_CHARS) continue;
    return c;
  }
  return '';
};

export interface WorkflowStreamingHeadlineParts {
  explicitStep: string;
  fallbackTool: string;
  proseSource: string;
}

/** Split B / raw A source / C for streaming headline composition (A commits in UI with idle/sentence rules). */
export const getWorkflowStreamingHeadlineParts = (
  blocks: AssistantContentBlock[],
  tools: ChatToolPayloadWithResult[],
): WorkflowStreamingHeadlineParts => {
  const last = tools.at(-1);
  return {
    explicitStep: last ? getExplicitStepHeadlineLine(last) : '',
    fallbackTool: last ? getToolFallbackHeadlineLine(last) : '',
    proseSource: extractLatestProseHeadlineSource(blocks),
  };
};

export const formatReasoningDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / TIME_MS_PER_SECOND);
  if (totalSeconds < DURATION_SECONDS_PER_MINUTE) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / DURATION_SECONDS_PER_MINUTE);
  const seconds = totalSeconds % DURATION_SECONDS_PER_MINUTE;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

export const getWorkflowSummaryText = (blocks: AssistantContentBlock[]): string => {
  const tools = blocks.flatMap((b) => b.tools ?? []);

  const groups = new Map<string, { count: number; errorCount: number }>();
  for (const tool of tools) {
    const existing = groups.get(tool.apiName) || { count: 0, errorCount: 0 };
    existing.count++;
    if (tool.result?.error) existing.errorCount++;
    groups.set(tool.apiName, existing);
  }

  const toolParts: string[] = [];
  for (const [apiName, { count, errorCount }] of groups) {
    let part = getToolDisplayName(apiName);
    if (count > 1) part += ` (${count})`;
    if (errorCount > 0) part += ' (failed)';
    toolParts.push(part);
  }

  let result = toolParts.join(', ');

  const totalReasoningMs = blocks.reduce((sum, b) => sum + (b.reasoning?.duration ?? 0), 0);
  if (totalReasoningMs > 0) {
    result += ` · Thought for ${formatReasoningDuration(totalReasoningMs)}`;
  }

  return result;
};
