import type { StepPresentationData } from '../agentRuntime/types';
import { getExtremeAck } from './ackPhrases';

// Use raw Unicode emoji instead of Chat SDK emoji placeholders,
// because bot-callback webhooks send via DiscordRestApi directly
// (not through the Chat SDK adapter that resolves placeholders).
const EMOJI_THINKING = '💭';
const EMOJI_SUCCESS = '✅';

// ==================== Message Splitting ====================

const DEFAULT_CHAR_LIMIT = 1800;

export function splitMessage(text: string, limit = DEFAULT_CHAR_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try to find a paragraph break
    let splitAt = remaining.lastIndexOf('\n\n', limit);
    // Fall back to line break
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', limit);
    // Hard cut
    if (splitAt <= 0) splitAt = limit;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  return chunks;
}

// ==================== Params ====================

type ToolCallItem = { apiName: string; arguments?: string; identifier: string };
type ToolResultItem = { apiName: string; identifier: string; isSuccess?: boolean; output?: string };

export interface RenderStepParams extends StepPresentationData {
  elapsedMs?: number;
  lastContent?: string;
  lastToolsCalling?: ToolCallItem[];
  platform?: string;
  totalToolCalls?: number;
}

// ==================== Helpers ====================

function formatToolName(tc: { apiName: string; identifier: string }): string {
  if (tc.identifier) return `**${tc.identifier}·${tc.apiName}**`;
  return `**${tc.apiName}**`;
}

function formatToolCall(tc: ToolCallItem): string {
  if (tc.arguments) {
    try {
      const args = JSON.parse(tc.arguments);
      const entries = Object.entries(args);
      if (entries.length > 0) {
        const [k, v] = entries[0];
        return `${formatToolName(tc)}(${k}: ${JSON.stringify(v)})`;
      }
    } catch {
      // invalid JSON, show name only
    }
  }
  return formatToolName(tc);
}

export function summarizeOutput(
  output: string | undefined,
  isSuccess?: boolean,
): string | undefined {
  if (!output) return undefined;
  const trimmed = output.trim();
  if (trimmed.length === 0) return undefined;

  const chars = trimmed.length;
  const status = isSuccess === false ? 'error' : 'success';
  return `${status}: ${chars.toLocaleString()} chars`;
}

function formatPendingTools(toolsCalling: ToolCallItem[]): string {
  return toolsCalling.map((tc) => `○ ${formatToolCall(tc)}`).join('\n');
}

function formatCompletedTools(
  toolsCalling: ToolCallItem[],
  toolsResult?: ToolResultItem[],
): string {
  return toolsCalling
    .map((tc, i) => {
      const callStr = `⏺ ${formatToolCall(tc)}`;
      const result = toolsResult?.[i];
      const summary = summarizeOutput(result?.output, result?.isSuccess);
      if (summary) {
        return `${callStr}\n⎿  ${summary}`;
      }
      return callStr;
    })
    .join('\n');
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function renderInlineStats(params: {
  elapsedMs?: number;
  platform?: string;
  totalCost: number;
  totalTokens: number;
  totalToolCalls?: number;
}): { footer: string; header: string } {
  const { elapsedMs, platform, totalToolCalls, totalTokens, totalCost } = params;
  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';

  const header =
    totalToolCalls && totalToolCalls > 0
      ? `> total **${totalToolCalls}** tools calling ${time}\n\n`
      : '';

  if (totalTokens <= 0) return { footer: '', header };

  const stats = `${formatTokens(totalTokens)} tokens · $${totalCost.toFixed(4)}`;
  // Discord uses -# for small text; other platforms render it as literal text
  const useSmallText = !platform || platform === 'discord';
  const footer = useSmallText ? `\n\n-# ${stats}` : `\n\n${stats}`;

  return { footer, header };
}

// ==================== 1. Start ====================

export const renderStart = getExtremeAck;

// ==================== 2. LLM Generating ====================

/**
 * LLM step just finished. Three sub-states:
 * - has reasoning (thinking)
 * - pure text content
 * - has tool calls (about to execute tools)
 */
export function renderLLMGenerating(params: RenderStepParams): string {
  const {
    content,
    elapsedMs,
    lastContent,
    platform,
    reasoning,
    toolsCalling,
    totalCost,
    totalTokens,
    totalToolCalls,
  } = params;
  const displayContent = (content || lastContent)?.trim();
  const { header, footer } = renderInlineStats({
    elapsedMs,
    platform,
    totalCost,
    totalTokens,
    totalToolCalls,
  });

  // Sub-state: LLM decided to call tools → show content + pending tool calls (○)
  if (toolsCalling && toolsCalling.length > 0) {
    const toolsList = formatPendingTools(toolsCalling);

    if (displayContent) return `${header}${displayContent}\n\n${toolsList}${footer}`;
    return `${header}${toolsList}${footer}`;
  }

  // Sub-state: has reasoning (thinking)
  if (reasoning && !content) {
    return `${header}${EMOJI_THINKING} ${reasoning?.trim()}${footer}`;
  }

  // Sub-state: pure text content (waiting for next step)
  if (displayContent) {
    return `${header}${displayContent}${footer}`;
  }

  return `${header}${EMOJI_THINKING} Processing...${footer}`;
}

// ==================== 3. Tool Executing ====================

/**
 * Tool step just finished, LLM is next.
 * Shows completed tools with results (⏺).
 */
export function renderToolExecuting(params: RenderStepParams): string {
  const {
    elapsedMs,
    lastContent,
    lastToolsCalling,
    platform,
    toolsResult,
    totalCost,
    totalTokens,
    totalToolCalls,
  } = params;
  const { header, footer } = renderInlineStats({
    elapsedMs,
    platform,
    totalCost,
    totalTokens,
    totalToolCalls,
  });

  const parts: string[] = [];

  if (header) parts.push(header.trimEnd());

  if (lastContent) parts.push(lastContent.trim());

  if (lastToolsCalling && lastToolsCalling.length > 0) {
    parts.push(formatCompletedTools(lastToolsCalling, toolsResult));
    parts.push(`${EMOJI_THINKING} Processing...`);
  } else {
    parts.push(`${EMOJI_THINKING} Processing...`);
  }

  return parts.join('\n\n') + footer;
}

// ==================== 4. Final Output ====================

export function renderFinalReply(
  content: string,
  params: {
    elapsedMs?: number;
    llmCalls: number;
    platform?: string;
    toolCalls: number;
    totalCost: number;
    totalTokens: number;
  },
): string {
  const { totalTokens, totalCost, llmCalls, toolCalls, elapsedMs, platform } = params;
  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';
  const calls = llmCalls > 1 || toolCalls > 0 ? ` | llm×${llmCalls} | tools×${toolCalls}` : '';
  const stats = `${formatTokens(totalTokens)} tokens · $${totalCost.toFixed(4)}${time}${calls}`;
  // Discord uses -# for small text; other platforms render it as literal text
  const useSmallText = !platform || platform === 'discord';
  const footer = useSmallText ? `-# ${stats}` : stats;
  return `${content.trimEnd()}\n\n${footer}`;
}

export function renderError(errorMessage: string): string {
  return `**Agent Execution Failed**\n\`\`\`\n${errorMessage}\n\`\`\``;
}

// ==================== Dispatcher ====================

/**
 * Dispatch to the correct template based on step state.
 */
export function renderStepProgress(params: RenderStepParams): string {
  if (params.stepType === 'call_llm') {
    // LLM step finished → about to execute tools
    return renderLLMGenerating(params);
  }

  // Tool step finished → LLM is next
  return renderToolExecuting(params);
}
