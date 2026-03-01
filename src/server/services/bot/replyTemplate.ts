import { emoji } from 'chat';

import type { StepPresentationData } from '../agentRuntime/types';
import { getExtremeAck } from './ackPhrases';

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
type ToolResultItem = { apiName: string; identifier: string; output?: string };

export interface RenderStepParams extends StepPresentationData {
  elapsedMs?: number;
  lastContent?: string;
  lastToolsCalling?: ToolCallItem[];
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

export function summarizeOutput(output: string | undefined, maxLength = 100): string | undefined {
  if (!output) return undefined;
  const lines = output.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return undefined;

  const firstLine = lines[0].length > maxLength ? lines[0].slice(0, maxLength) + '...' : lines[0];

  if (lines.length > 1) {
    return `${firstLine} … +${lines.length - 1} lines`;
  }
  return firstLine;
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
      const summary = summarizeOutput(toolsResult?.[i]?.output);
      if (summary) {
        return `${callStr}\n  ⎿  ${summary}`;
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
  totalCost: number;
  totalTokens: number;
  totalToolCalls?: number;
}): { footer: string; header: string } {
  const { elapsedMs, totalToolCalls, totalTokens, totalCost } = params;
  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';

  const header =
    totalToolCalls && totalToolCalls > 0
      ? `> total **${totalToolCalls}** tools calling ${time}\n\n`
      : '';

  if (totalTokens <= 0) return { footer: '', header };

  const footer = `\n\n-# ${formatTokens(totalTokens)} tokens · $${totalCost.toFixed(4)}`;

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
    reasoning,
    toolsCalling,
    totalCost,
    totalTokens,
    totalToolCalls,
  } = params;
  const displayContent = content || lastContent;
  const { header, footer } = renderInlineStats({
    elapsedMs,
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
    return `${header}${emoji.thinking} ${reasoning}${footer}`;
  }

  // Sub-state: pure text content (waiting for next step)
  if (displayContent) {
    return `${header}${displayContent}\n\n${footer}`;
  }

  return `${header}${emoji.thinking} Processing...${footer}`;
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
    toolsResult,
    totalCost,
    totalTokens,
    totalToolCalls,
  } = params;
  const { header, footer } = renderInlineStats({
    elapsedMs,
    totalCost,
    totalTokens,
    totalToolCalls,
  });

  const parts: string[] = [];

  if (header) parts.push(header.trimEnd());

  if (lastContent) parts.push(lastContent);

  if (lastToolsCalling && lastToolsCalling.length > 0) {
    parts.push(formatCompletedTools(lastToolsCalling, toolsResult));
    parts.push(`${emoji.thinking} Processing...`);
  } else {
    parts.push(`${emoji.thinking} Processing...`);
  }

  return parts.join('\n\n') + footer;
}

// ==================== 4. Final Output ====================

export function renderFinalReply(
  content: string,
  params: {
    elapsedMs?: number;
    llmCalls: number;
    toolCalls: number;
    totalCost: number;
    totalTokens: number;
  },
): string {
  const { totalTokens, totalCost, llmCalls, toolCalls, elapsedMs } = params;
  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';
  const calls = llmCalls > 1 || toolCalls > 0 ? ` | llm×${llmCalls} | tools×${toolCalls}` : '';
  const footer = `-# ${formatTokens(totalTokens)} tokens · $${totalCost.toFixed(4)}${time}${calls}`;
  return `${content}\n\n${footer}`;
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
