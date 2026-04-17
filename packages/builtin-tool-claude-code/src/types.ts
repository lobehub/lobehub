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
  Write = 'Write',
}
