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
