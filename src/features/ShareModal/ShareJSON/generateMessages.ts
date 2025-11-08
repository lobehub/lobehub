import { UIChatMessage } from '@lobechat/types';

import { LOADING_FLAT } from '@/const/message';

import { FieldType } from './type';

interface JSONParams extends FieldType {
  messages: UIChatMessage[];
  systemRole: string;
}
export const generateMessages = ({
  messages,
  withSystemRole,
  includeTool,
  systemRole,
}: JSONParams) => {
  const defaultMessages = messages
    .filter((m) => m.content !== LOADING_FLAT)
    .filter((m) => (!includeTool ? m.role !== 'tool' : true))
    .map((m) => ({
      content: m.content.trim(),
      role: m.role,
      tool_call_id: includeTool && m.tool_call_id ? m.tool_call_id : undefined,
      tools: includeTool && m.tools ? m.tools : undefined,
    }));

  return withSystemRole && !!systemRole
    ? [
        {
          content: systemRole,
          role: 'system',
        },
        ...defaultMessages,
      ]
    : defaultMessages;
};
