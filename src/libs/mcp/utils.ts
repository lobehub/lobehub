import type { ToolCRUDType } from '@/database/schemas';

// Prefix-based matching (anchored at ^) handles camelCase names like getReactions, listPins.
// \b word-boundary fails on camelCase because adjacent word-chars share no boundary.
const DELETE_PREFIX = /^(?:delete|remove|destroy|drop|unlink|uninstall|clear|purge)/;
const UPDATE_PREFIX = /^(?:update|edit|modify|patch|set|change|rename|move)/;
const READ_PREFIX =
  /^(?:get|list|read|fetch|search|find|check|describe|show|view|extract|query|count)/;

/**
 * Infer the CRUD operation type from an MCP tool name.
 *
 * Uses prefix matching so camelCase names like getReactions, listPins, searchMessages
 * are correctly classified as 'read'. Priority: delete > update > read > write.
 * The 'write' fallback covers create/add/save/send/upload/post/connect etc.
 */
export function inferCrudType(toolName: string): ToolCRUDType {
  const n = toolName.toLowerCase();
  if (DELETE_PREFIX.test(n)) return 'delete';
  if (UPDATE_PREFIX.test(n)) return 'update';
  if (READ_PREFIX.test(n)) return 'read';
  return 'write';
}
