import {
  type BuiltinInspector,
  type BuiltinRender,
  type RenderDisplayControl,
} from '@lobechat/types';

import FileChangeInspector from './FileChangeInspector';
import FileChangeRender from './FileChangeRender';
import McpToolInspector from './McpToolInspector';
import McpToolRender from './McpToolRender';
import TodoListInspector from './TodoListInspector';
import TodoListRender from './TodoListRender';
import WebSearchInspector from './WebSearchInspector';
import WebSearchRender from './WebSearchRender';

export const CodexInspectors: Record<string, BuiltinInspector> = {
  file_change: FileChangeInspector as BuiltinInspector,
  mcp_tool_call: McpToolInspector as BuiltinInspector,
  todo_list: TodoListInspector as BuiltinInspector,
  web_search: WebSearchInspector as BuiltinInspector,
};

export const CodexRenders: Record<string, BuiltinRender> = {
  file_change: FileChangeRender as BuiltinRender,
  mcp_tool_call: McpToolRender as BuiltinRender,
  todo_list: TodoListRender as BuiltinRender,
  web_search: WebSearchRender as BuiltinRender,
};

export const CodexRenderDisplayControls: Record<string, RenderDisplayControl> = {
  file_change: 'expand',
  mcp_tool_call: 'expand',
  todo_list: 'expand',
  web_search: 'expand',
};
