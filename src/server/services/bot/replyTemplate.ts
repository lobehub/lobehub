import type { StepPresentationData } from '../agentRuntime/types';
import { getExtremeAck } from './ackPhrases';
import { type BotReplyLocale, formatDuration } from './platforms';

// Use raw Unicode emoji instead of Chat SDK emoji placeholders,
// because bot-callback webhooks send via DiscordPlatformClient directly
// (not through the Chat SDK adapter that resolves placeholders).
const EMOJI_THINKING = '💭';

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

export { formatDuration, formatTokens } from './platforms';

function renderProgressHeader(params: { elapsedMs?: number; totalToolCalls?: number }): string {
  const { elapsedMs, totalToolCalls } = params;
  if (!totalToolCalls || totalToolCalls <= 0) return '';

  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';
  return `> total **${totalToolCalls}** tools calling ${time}\n\n`;
}

// ==================== 1. Start ====================

export const renderStart = getExtremeAck;

// ==================== 2. LLM Generating ====================

/**
 * LLM step just finished. Returns the message body (no usage stats).
 * Stats are handled separately via `PlatformClient.formatReply`.
 */
export function renderLLMGenerating(params: RenderStepParams): string {
  const { content, elapsedMs, lastContent, reasoning, toolsCalling, totalToolCalls } = params;
  const displayContent = (content || lastContent)?.trim();
  const header = renderProgressHeader({ elapsedMs, totalToolCalls });

  // Sub-state: LLM decided to call tools → show content + pending tool calls (○)
  if (toolsCalling && toolsCalling.length > 0) {
    const toolsList = formatPendingTools(toolsCalling);

    if (displayContent) return `${header}${displayContent}\n\n${toolsList}`;
    return `${header}${toolsList}`;
  }

  // Sub-state: has reasoning (thinking)
  if (reasoning && !content) {
    return `${header}${EMOJI_THINKING} ${reasoning?.trim()}`;
  }

  // Sub-state: pure text content (waiting for next step)
  if (displayContent) {
    return `${header}${displayContent}`;
  }

  return `${header}${EMOJI_THINKING} Processing...`;
}

// ==================== 3. Tool Executing ====================

/**
 * Tool step just finished, LLM is next.
 * Returns the message body (no usage stats).
 */
export function renderToolExecuting(params: RenderStepParams): string {
  const { elapsedMs, lastContent, lastToolsCalling, toolsResult, totalToolCalls } = params;
  const header = renderProgressHeader({ elapsedMs, totalToolCalls });

  const parts: string[] = [];

  if (header) parts.push(header.trimEnd());

  if (lastContent) parts.push(lastContent.trim());

  if (lastToolsCalling && lastToolsCalling.length > 0) {
    parts.push(formatCompletedTools(lastToolsCalling, toolsResult));
    parts.push(`${EMOJI_THINKING} Processing...`);
  } else {
    parts.push(`${EMOJI_THINKING} Processing...`);
  }

  return parts.join('\n\n');
}

// ==================== 4. Final Output ====================

/**
 * Returns the final reply body (content only, no usage stats).
 * Stats are handled separately via `PlatformClient.formatReply`.
 */
export function renderFinalReply(content: string): string {
  return content.trimEnd();
}

// ==================== System message strings ====================

/**
 * Static strings emitted by the bot itself (errors, stopped notices, DM
 * rejection). Keyed by IETF locale so it lines up with the project-wide
 * `Locales` set; new platform languages can be added by dropping in another
 * entry without touching the type. A missing locale falls back to `en-US`
 * at lookup time, so we never silently render `undefined`.
 *
 * Agent conversation content is produced by the LLM and is not routed
 * through this map.
 */
type SystemStrings = {
  dmRejectedAllowlist: string;
  dmRejectedDisabled: string;
  error: string;
  errorWithId: (operationId: string) => string;
  stoppedDefault: string;
};

const SYSTEM_STRINGS: Partial<Record<BotReplyLocale, SystemStrings>> = {
  'en-US': {
    dmRejectedAllowlist:
      "Sorry, you aren't authorized to send direct messages to this bot. Please contact the bot's owner if you need access.",
    dmRejectedDisabled:
      "This bot isn't accepting direct messages. Please reach out by mentioning it in a shared channel or group instead.",
    error: '**Agent Execution Failed**',
    errorWithId: (operationId) => `**Agent Execution Failed**\nOperation ID: \`${operationId}\``,
    stoppedDefault: 'Execution stopped.',
  },
  'zh-CN': {
    dmRejectedAllowlist: '抱歉，您没有私信该机器人的权限。如需访问请联系机器人管理员。',
    dmRejectedDisabled: '该机器人不接受私信。请在共享频道或群组里 @它来联系。',
    error: '**Agent 执行失败**',
    errorWithId: (operationId) => `**Agent 执行失败**\nOperation ID: \`${operationId}\``,
    stoppedDefault: '执行已停止。',
  },
};

const DEFAULT_REPLY_LOCALE: BotReplyLocale = 'en-US';

const getSystemStrings = (lng: BotReplyLocale = DEFAULT_REPLY_LOCALE): SystemStrings =>
  SYSTEM_STRINGS[lng] ?? SYSTEM_STRINGS[DEFAULT_REPLY_LOCALE]!;

export function renderError(operationId?: string, lng?: BotReplyLocale): string {
  const strings = getSystemStrings(lng);
  return operationId ? strings.errorWithId(operationId) : strings.error;
}

export function renderStopped(message?: string, lng?: BotReplyLocale): string {
  return message ?? getSystemStrings(lng).stoppedDefault;
}

/**
 * Render the system message shown to a sender whose DM was blocked by the
 * channel's DM Policy. We split disabled vs allowlist so the user can act on
 * the answer (e.g. ping in a channel instead, or ask the owner for access).
 */
export function renderDmRejected(reason: 'disabled' | 'allowlist', lng?: BotReplyLocale): string {
  const strings = getSystemStrings(lng);
  return reason === 'disabled' ? strings.dmRejectedDisabled : strings.dmRejectedAllowlist;
}

// ==================== Dispatcher ====================

/**
 * Dispatch to the correct template based on step state.
 * Returns message body only — caller handles stats via platform.
 */
export function renderStepProgress(params: RenderStepParams): string {
  if (params.stepType === 'call_llm') {
    return renderLLMGenerating(params);
  }
  return renderToolExecuting(params);
}
