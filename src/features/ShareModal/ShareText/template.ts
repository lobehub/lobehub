import { isCallSubAgentCall, stripSubAgentReference } from '@lobechat/builtin-tool-lobe-agent';
import { type UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';
import { normalizeThinkTags, processWithArtifact } from '@/features/Conversation/utils/markdown';
import { type FieldType } from '@/features/ShareModal/ShareText/type';

interface MarkdownParams extends FieldType {
  messages: UIChatMessage[];
  systemRole: string;
  title: string;
}

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
    .map((message) => ({
      ...message,
      content: normalizeThinkTags(processWithArtifact(message.content)),
    }));

  for (const chat of filteredMessages) {
    parts.push('');

    if (withRole) {
      if (chat.role === 'user') {
        parts.push('##### User:', '');
      } else if (chat.role === 'assistant') {
        parts.push('##### Assistant:', '');
      } else if (chat.role === 'tool') {
        parts.push('##### Tools Calling:', '');
      }
    }

    if (chat.role === 'tool') {
      // The sub-agent reference is a hidden address for the parent agent, not
      // part of the readable result. JSON export keeps it so an imported
      // conversation can still continue that sub-agent.
      const content = isCallSubAgentCall(chat.plugin)
        ? stripSubAgentReference(String(chat.content))
        : String(chat.content);
      parts.push('```json', content, '```');
    } else {
      parts.push(String(chat.content));

      if (includeTool && chat.tools && chat.tools.length > 0) {
        parts.push('', '```json', JSON.stringify(chat.tools, null, 2), '```');
      }
    }
  }

  return parts.join('\n');
};
