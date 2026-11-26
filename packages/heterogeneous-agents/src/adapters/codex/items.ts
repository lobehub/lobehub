import type { HeterogeneousToolResultImage } from '../../types';

const CODEX_COLLAB_TOOL_CALL_API = 'collab_tool_call';
export const CODEX_COMMAND_API = 'command_execution';
const CODEX_ERROR_ITEM_TYPE = 'error';
const CODEX_FILE_CHANGE_API = 'file_change';
const CODEX_MCP_TOOL_CALL_API = 'mcp_tool_call';
const CODEX_TODO_LIST_API = 'todo_list';
const CODEX_WEB_SEARCH_API = 'web_search';

interface CodexBaseItem {
  id: string;
  status?: string;
  type: string;
}

interface CodexCommandExecutionItem extends CodexBaseItem {
  aggregated_output?: string;
  command?: string;
  exit_code?: number | null;
}

/** Image tool outputs omitted by exec --json and recovered from its rollout. */
export interface CodexImageOutputItem extends CodexBaseItem {
  images: HeterogeneousToolResultImage[];
  type: 'image_output';
}

interface CodexTodoListEntry {
  completed?: boolean;
  text?: string;
}

export interface CodexTodoListItem extends CodexBaseItem {
  items?: CodexTodoListEntry[];
}

interface CodexFileChangeEntry {
  diffText?: string;
  kind?: string;
  linesAdded?: number;
  linesDeleted?: number;
  path?: string;
}

export interface CodexFileChangeItem extends CodexBaseItem {
  changes?: CodexFileChangeEntry[];
  diffText?: string;
  linesAdded?: number;
  linesDeleted?: number;
}

export interface CodexMcpToolCallItem extends CodexBaseItem {
  arguments?: unknown;
  error?: unknown;
  result?: unknown;
  server?: string;
  tool?: string;
}

export interface CodexWebSearchItem extends CodexBaseItem {
  action?: unknown;
  query?: unknown;
}

interface CodexCollabAgentState {
  message?: string | null;
  status?: string;
}

export interface CodexCollabToolCallItem extends CodexBaseItem {
  agents_states?: Record<string, CodexCollabAgentState>;
  prompt?: string | null;
  receiver_thread_ids?: string[];
  sender_thread_id?: string;
  tool?: string;
}

export type CodexToolItem =
  | CodexBaseItem
  | CodexCollabToolCallItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexImageOutputItem
  | CodexMcpToolCallItem
  | CodexTodoListItem
  | CodexWebSearchItem;

// exec --json reports non-fatal notices (config/deprecation warnings) as `error` items;
// fatal failures arrive as top-level `error` / `turn.failed` events instead.
export const isNonToolItemType = (type: string) =>
  type === 'agent_message' || type === CODEX_ERROR_ITEM_TYPE;

export const isImageOutputItem = (item: CodexToolItem): item is CodexImageOutputItem =>
  item.type === 'image_output';

export const isCommandExecutionItem = (item: CodexToolItem): item is CodexCommandExecutionItem =>
  item.type === CODEX_COMMAND_API;

export const isCollabToolCallItem = (item: CodexToolItem): item is CodexCollabToolCallItem =>
  item.type === CODEX_COLLAB_TOOL_CALL_API;

export const isFileChangeItem = (item: CodexToolItem): item is CodexFileChangeItem =>
  item.type === CODEX_FILE_CHANGE_API;

export const isMcpToolCallItem = (item: CodexToolItem): item is CodexMcpToolCallItem =>
  item.type === CODEX_MCP_TOOL_CALL_API;

export const isTodoListItem = (item: CodexToolItem): item is CodexTodoListItem =>
  item.type === CODEX_TODO_LIST_API;

export const isWebSearchItem = (item: CodexToolItem): item is CodexWebSearchItem =>
  item.type === CODEX_WEB_SEARCH_API;
