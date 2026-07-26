import { LOADING_FLAT } from '@lobechat/const';
import type { UIChatMessage } from '@lobechat/types';

const ASSISTANT_GROUP_STATUS_TEXT_MAX_LENGTH = 100;
const MARKDOWN_HEADING_MAX_LEVEL = 6;

const normalizeAuthoredContent = (content?: string | null) => {
  if (!content?.trim() || content === LOADING_FLAT) return;
  return content;
};

/**
 * Whether assistant prose reads as a short workflow status rather than answer content.
 * Keep this shared with the renderer so persisted previews do not surface text that the UI
 * folds into the workflow process.
 */
export const isAssistantGroupStatusText = (content?: string | null): boolean => {
  const raw = content?.trim() ?? '';
  if (!raw || raw === LOADING_FLAT) return true;
  if (raw.includes('\n')) return false;

  if (new RegExp(`^#{1,${MARKDOWN_HEADING_MAX_LEVEL}}\\s`).test(raw) || /^[-*]\s+\S/.test(raw))
    return false;

  if (raw.length > ASSISTANT_GROUP_STATUS_TEXT_MAX_LENGTH) return false;

  const sentenceCount = (raw.match(/[。！？]|[.!?](?=\s|$)/g) ?? []).length;
  return sentenceCount <= 1;
};

/**
 * Resolve the authored text that best represents a parsed assistant group.
 *
 * Post-task summaries render after the main chain and therefore win. In the main chain,
 * trailing short status text attached to tool calls stays folded as workflow context when an
 * earlier answer exists. If a group contains only such status text, keep the latest authored
 * block as a useful fallback instead of returning an empty preview.
 */
export const resolveAssistantGroupFinalContent = (message?: UIChatMessage): string | undefined => {
  for (let index = (message?.taskCompletions?.length ?? 0) - 1; index >= 0; index -= 1) {
    const content = normalizeAuthoredContent(message?.taskCompletions?.[index]?.content);
    if (content) return content;
  }

  let latestAuthoredContent: string | undefined;
  for (let index = (message?.children?.length ?? 0) - 1; index >= 0; index -= 1) {
    const block = message?.children?.[index];
    const content = normalizeAuthoredContent(block?.content);
    if (!content) continue;

    latestAuthoredContent ??= content;
    const isTrailingToolStatus =
      !!block?.tools?.length && isAssistantGroupStatusText(block.content);
    if (!isTrailingToolStatus) return content;
  }

  return normalizeAuthoredContent(message?.content) ?? latestAuthoredContent;
};
