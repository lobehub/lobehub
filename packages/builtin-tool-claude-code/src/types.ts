/**
 * Claude Code agent identifier — matches the value emitted by
 * `ClaudeCodeAdapter` when it converts `tool_use` blocks into
 * `ToolCallPayload.identifier`.
 */
export const ClaudeCodeIdentifier = 'claude-code';

/**
 * Canonical Claude Code tool names (the `name` field on `tool_use` blocks).
 * Kept as string literals so future additions (WebSearch, Task, etc.) can be
 * wired in without downstream enum migrations.
 */
export enum ClaudeCodeApiName {
  Bash = 'Bash',
  Edit = 'Edit',
  Glob = 'Glob',
  Grep = 'Grep',
  Read = 'Read',
  Skill = 'Skill',
  /**
   * Spawns a subagent. CC emits this as a regular `tool_use`; downstream
   * events for the subagent's internal turns are tagged with
   * `parent_tool_use_id` pointing back at this tool_use's id, and the
   * subagent's final answer arrives as the `tool_result` for this id.
   * The executor turns this into a Thread (linked via
   * `metadata.sourceToolCallId = tool_use.id`) instead of a separate
   * `role: 'task'` message.
   */
  Task = 'Task',
  TodoWrite = 'TodoWrite',
  ToolSearch = 'ToolSearch',
  Write = 'Write',
}

/**
 * Status of a single todo item in a `TodoWrite` tool_use.
 * Matches Claude Code's native schema — do not reuse GTD's `TodoStatus`,
 * which has a different vocabulary (`todo` / `processing`).
 */
export type ClaudeCodeTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface ClaudeCodeTodoItem {
  /** Present-continuous form, shown while the item is in progress */
  activeForm: string;
  /** Imperative description, shown in pending & completed states */
  content: string;
  status: ClaudeCodeTodoStatus;
}

export interface TodoWriteArgs {
  todos: ClaudeCodeTodoItem[];
}

/**
 * Arguments for CC's built-in `Skill` tool. CC invokes this to activate an
 * installed skill (e.g. `local-testing`); the tool_result carries the skill's
 * SKILL.md body back to the model.
 */
export interface SkillArgs {
  skill?: string;
}

/**
 * Arguments for CC's built-in `ToolSearch` tool. CC invokes this to load
 * schemas for deferred tools before calling them. `query` is either
 * `select:<name>[,<name>...]` for direct fetch, or keyword search with
 * optional `+term` to require a keyword.
 */
export interface ToolSearchArgs {
  max_results?: number;
  query?: string;
}

/**
 * Arguments for CC's built-in `Task` tool. The model fills these in when it
 * decides to delegate work to a subagent: the description shows up in the
 * folded header, the prompt becomes the subagent's initial user message, and
 * `subagent_type` selects which subagent template handles it.
 */
export interface TaskArgs {
  description?: string;
  prompt?: string;
  subagent_type?: string;
}
