import { isRecord, toRecord } from '@lobechat/utils/object';

import type { ToolCRUDType } from '@/database/schemas';

/** The expected HTTP connection failures normalized by MCPClient.initialize. */
export const getMCPConnectionErrorType = (error: unknown) => {
  const type = toRecord(toRecord(error)?.data)?.type;
  if (
    type === 'AUTHORIZATION_ERROR' ||
    type === 'INITIALIZATION_TIMEOUT' ||
    type === 'CONNECTION_FAILED'
  )
    return type;
};

// Prefix-based matching (anchored at ^) handles camelCase names like getReactions, listPins.
// \b word-boundary fails on camelCase because adjacent word-chars share no boundary.
const DELETE_PREFIX = /^(?:delete|remove|destroy|drop|unlink|uninstall|clear|purge)/;
const UPDATE_PREFIX = /^(?:update|edit|modify|patch|set|change|rename|move)/;
const READ_PREFIX =
  /^(?:get|list|read|fetch|search|find|check|describe|show|view|extract|query|count)/;

export interface MCPErrorLogMetadata {
  code?: number;
  name: string;
  status?: number;
}

/**
 * Error messages and objects are untrusted remote data, so MCP logs only keep fixed metadata.
 * SDK HTTP errors carry the HTTP status in `status`; their `code` is an SDK string.
 */
export const getMCPErrorLogMetadata = (error: unknown): MCPErrorLogMetadata => {
  const errorRecord = isRecord(error) ? error : undefined;
  const rawCode = errorRecord?.code;
  const code = typeof rawCode === 'number' ? rawCode : undefined;
  const rawStatus = errorRecord?.status;
  const status = typeof rawStatus === 'number' ? rawStatus : undefined;

  return {
    code,
    name: error instanceof Error ? 'Error' : typeof error,
    ...(status !== undefined && { status }),
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
