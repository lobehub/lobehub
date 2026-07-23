import { type BuiltinInspector, type BuiltinRender } from '@lobechat/types';

import CollabToolInspector from './CollabToolInspector';
import CollabToolRender from './CollabToolRender';
import CommandExecutionInspector from './CommandExecutionInspector';
import { CodexRenderDisplayControls } from './displayControls';
import ErrorInspector from './ErrorInspector';
import FileChangeInspector from './FileChangeInspector';
import FileChangeRender from './FileChangeRender';
import McpToolInspector from './McpToolInspector';
import McpToolRender from './McpToolRender';
import TodoListInspector from './TodoListInspector';
import TodoListRender from './TodoListRender';
import WebSearchInspector from './WebSearchInspector';
import WebSearchRender from './WebSearchRender';

export const CodexInspectors: Record<string, BuiltinInspector> = {
  collab_tool_call: CollabToolInspector as BuiltinInspector,
  command_execution: CommandExecutionInspector as BuiltinInspector,
  error: ErrorInspector as BuiltinInspector,
  file_change: FileChangeInspector as BuiltinInspector,
  mcp_tool_call: McpToolInspector as BuiltinInspector,
  todo_list: TodoListInspector as BuiltinInspector,
  web_search: WebSearchInspector as BuiltinInspector,
};

export const CodexRenders: Record<string, BuiltinRender> = {
  collab_tool_call: CollabToolRender as BuiltinRender,
  file_change: FileChangeRender as BuiltinRender,
  mcp_tool_call: McpToolRender as BuiltinRender,
  todo_list: TodoListRender as BuiltinRender,
  web_search: WebSearchRender as BuiltinRender,
};

export { CodexRenderDisplayControls };
