import { isRecord } from '@lobechat/utils/object';

import type { ToolCRUDType } from '@/database/schemas';

// Prefix-based matching (anchored at ^) handles camelCase names like getReactions, listPins.
// \b word-boundary fails on camelCase because adjacent word-chars share no boundary.
const DELETE_PREFIX = /^(?:delete|remove|destroy|drop|unlink|uninstall|clear|purge)/;
const UPDATE_PREFIX = /^(?:update|edit|modify|patch|set|change|rename|move)/;
const READ_PREFIX =
  /^(?:get|list|read|fetch|search|find|check|describe|show|view|extract|query|count)/;

export interface MCPErrorLogMetadata {
  code?: number;
  name: string;
}

/**
 * Error messages and objects are untrusted remote data, so MCP logs only keep fixed metadata.
 */
export const getMCPErrorLogMetadata = (error: unknown): MCPErrorLogMetadata => {
  const errorRecord = isRecord(error) ? error : undefined;
  const rawCode = errorRecord?.code;
  const code = typeof rawCode === 'number' ? rawCode : undefined;

  return {
    code,
    name: error instanceof Error ? 'Error' : typeof error,
  };
};

/**
 * URL paths can contain session keys or signed values, so logs retain the origin only.
 */
export const getMCPLogOrigin = (endpoint: string): string | undefined => {
  try {
    return new URL(endpoint).origin;
  } catch {
    return undefined;
  }
};

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
