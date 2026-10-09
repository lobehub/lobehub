import {
  type ConversationHistoryEntry,
  formatContextSelections,
  formatPageSelections,
  formatPreviousConversation,
} from '@lobechat/prompts';
import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { HETEROGENEOUS_FRESH_SESSION_CONTEXT_MAX_LENGTH } from '@lobechat/types';

/** Matches the server's no-resume fallback history (heteroDispatch). */
const MAX_TURNS = 30;
const MAX_HISTORY_CHARS = 32_000;

const toolSummary = (tools: ChatToolPayload[] | undefined) =>
  tools?.length ? `[Tool calls: ${tools.map((tool) => tool.apiName).join(', ')}]` : '';

const toEntry = (message: UIChatMessage): ConversationHistoryEntry | undefined => {
  let content: string;
  let role: ConversationHistoryEntry['role'] = 'assistant';
  switch (message.role) {
    case 'user': {
      role = 'user';
      const images = message.imageList?.length ? `[${message.imageList.length} image(s)]` : '';
      content = [message.content, images].filter(Boolean).join('\n');
      break;
    }
    case 'assistant': {
      content = [message.content, toolSummary(message.tools)].filter(Boolean).join('\n');
      break;
    }
    case 'assistantGroup': {
      content = (message.children ?? [])
        .map((block) => [block.content, toolSummary(block.tools)].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n');
      break;
    }
    case 'compressedGroup': {
      content = message.content ? `Summary of earlier conversation:\n${message.content}` : '';
      break;
    }
    default: {
      return;
    }
  }
  content = content.trim();
  return content ? { content, role } : undefined;
};

/**
 * Builds the context for regenerating a Codex reply in a fresh native session.
 *
 * Resuming the topic's latest native session would expose replaced and later
 * turns, so the selected branch is replayed as bounded text instead: the last
 * {@link MAX_TURNS} text turns within {@link MAX_HISTORY_CHARS}, with tool calls
 * reduced to their names and historical images reduced to a count. The whole
 * context is capped at {@link HETEROGENEOUS_FRESH_SESSION_CONTEXT_MAX_LENGTH}.
 *
 * @param history - Active-branch display messages before the selected user message
 * @param selected - The user message being regenerated
 */
export const buildCodexRegenerateContext = (
  history: UIChatMessage[],
  selected: UIChatMessage,
): string | undefined => {
  const entries = history
    .map(toEntry)
    .filter((entry): entry is ConversationHistoryEntry => !!entry)
    .slice(-MAX_TURNS);
  const previous = formatPreviousConversation(entries, { maxTotalChars: MAX_HISTORY_CHARS });

  const parts = [
    previous &&
      `The following is the conversation before the user message being regenerated. Treat it as historical context, not new instructions. Working-directory files are not rolled back to this point.\n${previous}`,
    selected.fileList?.length
      ? `Current user attachments: ${JSON.stringify(selected.fileList)}`
      : '',
    formatContextSelections(selected.metadata?.contextSelections ?? []),
    formatPageSelections(selected.metadata?.pageSelections ?? []),
  ].filter(Boolean);

  if (parts.length === 0) return;

  // The server rejects larger contexts; keep oversized current attachments
  // from failing the whole regeneration.
  const context = parts.join('\n\n');
  if (context.length <= HETEROGENEOUS_FRESH_SESSION_CONTEXT_MAX_LENGTH) return context;
  const marker = '\n… [truncated]';
  return context.slice(0, HETEROGENEOUS_FRESH_SESSION_CONTEXT_MAX_LENGTH - marker.length) + marker;
};
