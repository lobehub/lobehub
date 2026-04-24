import { type ChatToolPayloadWithResult } from '@lobechat/types';
import { t } from 'i18next';

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

/** Heuristic: visible content already looks like a deliverable, not a one-line status step. */
export const scoreBlockContentAsAnswerLike = (block: AssistantContentBlock): number => {
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

/** Heuristic: prose-only block after last tool looks like a long deliverable (not a one-line step). */
export const scorePostToolBlockAsFinalAnswer = (block: AssistantContentBlock): number => {
  if (block.tools && block.tools.length > 0) return 0;

  return scoreBlockContentAsAnswerLike(block);
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
  const defaultValue = toTitleCase(apiName);
  const key = TOOL_API_DISPLAY_NAMES[apiName];
  if (!key) return defaultValue;

  return t(key, { defaultValue, ns: 'chat' });
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

export const getWorkflowCompletionStatus = (
  tools: ChatToolPayloadWithResult[],
): 'success' | 'partial' | 'error' => {
  const collapsible = tools.filter((t) => t.intervention?.status !== 'pending');
  if (collapsible.length === 0) return 'success';

  const completed = collapsible.filter(
    (t) => t.result != null && t.result.content !== LOADING_FLAT,
  );
  if (completed.length === 0) return 'success';

  const errorCount = completed.filter((t) => t.result?.error).length;
  if (errorCount === 0) return 'success';
  if (errorCount === completed.length) return 'error';
  return 'partial';
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

const extractMarkdownHeadingTitle = (md: string): string => {
  const withoutCode = md.replaceAll(/```[\s\S]*?```/g, ' ');
  const lines = withoutCode.split('\n');
  let lastTitle = '';

  for (const line of lines) {
    const match = line.match(
      new RegExp(`^\\s{0,3}#{1,${WORKFLOW_MARKDOWN_HEADING_MAX_LEVEL}}\\s+(.+?)\\s*$`),
    );
    if (!match) continue;

    const raw = match[1]?.replace(/\s+#+\s*$/, '') ?? '';
    const title = stripLightMarkdownForHeadline(raw).replaceAll(/\s+/g, ' ').trim();
    if (!title) continue;

    lastTitle = truncateDisplayAtWord(title, WORKFLOW_PROSE_HEADLINE_MAX_CHARS);
  }

  return lastTitle;
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

const getBlockContent = (block: AssistantContentBlock): string => {
  const content = block.content?.trim() ?? '';
  if (!content || content === LOADING_FLAT) return '';
  return content;
};

const getBlockReasoningContent = (block: AssistantContentBlock): string => {
  const reasoning = block.reasoning?.content?.trim() ?? '';
  if (!reasoning || reasoning === LOADING_FLAT) return '';
  return reasoning;
};

const isThinkingOnlyBlock = (block: AssistantContentBlock): boolean => {
  if (block.tools?.length) return false;
  if ((block.imageList?.length ?? 0) > 0) return false;
  return !!getBlockReasoningContent(block) && !getBlockContent(block) && !block.error;
};

export type WorkflowStreamingHeadlineState =
  | { kind: 'idle' }
  | { kind: 'prose'; proseSource: string }
  | { kind: 'thinking'; reasoningTitle: string }
  | { explicitStep: string; fallbackTool: string; kind: 'tool' };

const getHeadlineStateFromBlock = (
  block: AssistantContentBlock,
): WorkflowStreamingHeadlineState | null => {
  if (block.tools?.length) {
    const lastTool = block.tools.at(-1);
    const explicitStep = lastTool ? getExplicitStepHeadlineLine(lastTool) : '';
    const fallbackTool = lastTool ? getToolFallbackHeadlineLine(lastTool) : '';
    if (!explicitStep && !fallbackTool) return null;

    return {
      explicitStep,
      fallbackTool,
      kind: 'tool',
    };
  }

  if (isThinkingOnlyBlock(block)) {
    const reasoningTitle = extractMarkdownHeadingTitle(getBlockReasoningContent(block));
    if (!reasoningTitle) return null;

    return {
      kind: 'thinking',
      reasoningTitle,
    };
  }

  const proseSource = getBlockContent(block);
  if (proseSource.length < WORKFLOW_PROSE_SOURCE_MIN_CHARS) return null;

  return { kind: 'prose', proseSource };
};

/** Walk backward and return the first block that can produce a meaningful headline state. */
export const getWorkflowStreamingHeadlineState = (
  blocks: AssistantContentBlock[],
): WorkflowStreamingHeadlineState => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (!block) continue;

    const state = getHeadlineStateFromBlock(block);
    if (state) return state;
  }

  return { kind: 'idle' };
};

export const formatReasoningDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / TIME_MS_PER_SECOND);
  if (totalSeconds < DURATION_SECONDS_PER_MINUTE) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / DURATION_SECONDS_PER_MINUTE);
  const seconds = totalSeconds % DURATION_SECONDS_PER_MINUTE;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

const WORKFLOW_SUMMARY_TOP_N = 3;

export const getWorkflowSummaryText = (blocks: AssistantContentBlock[]): string => {
  const tools = blocks.flatMap((b) => b.tools ?? []);

  const groups = new Map<string, { count: number; errorCount: number }>();
  for (const tool of tools) {
    const existing = groups.get(tool.apiName) || { count: 0, errorCount: 0 };
    existing.count++;
    if (tool.result?.error) existing.errorCount++;
    groups.set(tool.apiName, existing);
  }

  const entries = [...groups.entries()];
  const totalKinds = entries.length;
  const totalCalls = entries.reduce((sum, [, { count }]) => sum + count, 0);
  const totalErrors = entries.reduce((sum, [, { errorCount }]) => sum + errorCount, 0);

  const formatToolPart = ([apiName, info]: [string, { count: number }]): string => {
    const name = getToolDisplayName(apiName);
    return info.count > 1 ? `${name} (${info.count})` : name;
  };

  // List all kinds when few; truncate to top N (by call count) when many.
  // "+1 more" reads awkwardly, so we only collapse when there are ≥2 extra kinds beyond top N.
  const displayedEntries =
    totalKinds <= WORKFLOW_SUMMARY_TOP_N + 1
      ? entries
      : [...entries].sort(([, a], [, b]) => b.count - a.count).slice(0, WORKFLOW_SUMMARY_TOP_N);

  const segments: string[] = [displayedEntries.map(formatToolPart).join(', ')];

  // Only show "N tool kinds" when the list is truncated — otherwise it duplicates the visible list.
  if (displayedEntries.length < totalKinds) {
    segments.push(
      t('workflow.summaryMoreTools', {
        count: totalKinds,
        defaultValue: '{{count}} tool kinds',
        ns: 'chat',
      }),
    );
  }
  // Only show total calls when a tool was called more than once — otherwise totalCalls
  // equals totalKinds and the suffix duplicates info already in the list.
  if (totalKinds > 1 && totalCalls > totalKinds) {
    segments.push(
      t('workflow.summaryTotalCalls', {
        count: totalCalls,
        defaultValue: '{{count}} calls total',
        ns: 'chat',
      }),
    );
  }
  if (totalErrors > 0) {
    segments.push(
      t('workflow.summaryFailed', {
        count: totalErrors,
        defaultValue: '{{count}} failed',
        ns: 'chat',
      }),
    );
  }
  let result = segments.join(' · ');

  const totalReasoningMs = blocks.reduce((sum, b) => sum + (b.reasoning?.duration ?? 0), 0);
  if (totalReasoningMs > 0) {
    result += ` · ${t('workflow.thoughtForDuration', {
      defaultValue: 'Thought for {{duration}}',
      duration: formatReasoningDuration(totalReasoningMs),
      ns: 'chat',
    })}`;
  }

  return result;
};
