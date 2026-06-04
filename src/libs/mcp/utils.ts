import type { ToolCRUDType } from '@/database/schemas';

const DELETE_PATTERN = /\b(?:delete|remove|destroy|drop|unlink|uninstall|clear|purge)\b/;
const UPDATE_PATTERN = /\b(?:update|edit|modify|patch|set|change|rename|move)\b/;
const READ_PATTERN =
  /\b(?:get|list|read|fetch|search|find|check|describe|show|view|extract|query|count)\b/;

/**
 * Infer the CRUD operation type from an MCP tool name.
 *
 * Priority: delete > update > read > write (conservative default).
 * The 'write' fallback covers create/add/save/send/upload/post/publish etc.
 */
export function inferCrudType(toolName: string): ToolCRUDType {
  const n = toolName.toLowerCase();
  if (DELETE_PATTERN.test(n)) return 'delete';
  if (UPDATE_PATTERN.test(n)) return 'update';
  if (READ_PATTERN.test(n)) return 'read';
  return 'write';
}
