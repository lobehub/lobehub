import { resolveAssistantGroupFinalContent } from '@lobechat/conversation-flow';
import { type UIChatMessage, type UIMessageRoleType } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';
import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';
import { type FieldType } from '@/features/ShareModal/ShareText/type';

interface MarkdownParams extends FieldType {
  messages: UIChatMessage[];
  systemRole: string;
  title: string;
}

const normalizeAuthoredContent = (content?: string | null) => content?.trim() || undefined;

/**
 * Virtual roles emitted by `parse()`. It empties `content` and moves the authored
 * text into `children[]` / `taskCompletions[]` for assistant groups, and into
 * `tasks[]` for task groups, so a template that only reads `content` turns every
 * one of these turns into a blank line and the Text/PDF export loses the assistant
 * replies entirely.
 */
const VIRTUAL_ASSISTANT_ROLES = new Set<UIMessageRoleType>([
  'assistantGroup',
  'groupTasks',
  'supervisor',
  'tasks',
]);

/**
 * The assistant text a virtual row actually shows, resolved the same way the chat
 * renderer resolves it, so the export matches what the user sees on screen.
 */
const resolveVirtualAssistantContent = (message: UIChatMessage): string | undefined => {
  if (message.role === 'assistantGroup' || message.role === 'supervisor') {
    return resolveAssistantGroupFinalContent(message);
  }

  return (
    (message.tasks ?? [])
      .map((task) => normalizeAuthoredContent(task.content))
      .filter((content): content is string => !!content)
      .join('\n\n') || undefined
  );
};

export const generateMarkdown = ({
  messages,
  title,
  includeTool,
  includeUser,
  withSystemRole,
  withRole,
  systemRole,
}: MarkdownParams): string => {
  const parts: string[] = [`# ${title}`, ''];

  if (withSystemRole && systemRole) {
    parts.push('````md', systemRole, '````', '');
  }

  const filteredMessages = messages
    .filter((m) => m.content !== LOADING_FLAT)
    .filter((m) => (!includeUser ? m.role !== 'user' : true))
    .filter((m) => (!includeTool ? m.role !== 'tool' : true))
    .map((message) => {
      const isVirtualAssistant = VIRTUAL_ASSISTANT_ROLES.has(message.role);
      const authored = isVirtualAssistant
        ? resolveVirtualAssistantContent(message)
        : message.content;

      return {
        ...message,
        content: authored ? normalizeThinkTags(processWithArtifact(authored)) : '',
        isVirtualAssistant,
      };
    });

  for (const chat of filteredMessages) {
    // Nothing authored to export: skip the row rather than emit a blank block.
    if (chat.isVirtualAssistant && !chat.content) continue;

    parts.push('');

    if (withRole) {
      if (chat.role === 'user') {
        parts.push('##### User:', '');
      } else if (chat.role === 'assistant' || chat.isVirtualAssistant) {
        parts.push('##### Assistant:', '');
      } else if (chat.role === 'tool') {
        parts.push('##### Tools Calling:', '');
      }
    }

    if (chat.role === 'tool') {
      parts.push('```json', String(chat.content), '```');
    } else {
      parts.push(String(chat.content));

      if (includeTool && chat.tools && chat.tools.length > 0) {
        parts.push('', '```json', JSON.stringify(chat.tools, null, 2), '```');
      }
    }
  }

  return parts.join('\n');
};
