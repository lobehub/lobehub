import type { RenderDisplayControl } from '@lobechat/types';

export const CodexRenderDisplayControls: Record<string, RenderDisplayControl> = {
  collab_tool_call: 'expand',
  command_execution: 'collapsed',
  file_change: 'expand',
  mcp_tool_call: 'expand',
  todo_list: 'expand',
  web_search: 'expand',
};
