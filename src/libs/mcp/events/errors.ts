import { toRecord } from '@lobechat/utils/object';

import { createMCPError } from '../types';

export const MCP_EVENT_ERROR_CODES = {
  NotFound: -32023,
  Forbidden: -32024,
  ResourceExhausted: -32025,
  Unsupported: -32026,
  CallbackEndpointError: -32027,
  InvalidParams: -32602,
} as const;
export type McpEventErrorName = keyof typeof MCP_EVENT_ERROR_CODES;

/** Inspect nested TRPC causes too: MCPService preserves upstream errors as its cause. */
export const getMcpEventErrorName = (error: unknown): McpEventErrorName | undefined => {
  const seen = new Set<unknown>();
  for (let current = error; current && !seen.has(current); current = toRecord(current)?.cause) {
    seen.add(current);
    const record = toRecord(current) ?? {};
    // Symbolic names survive draft code-number changes, so prefer them.
    for (const name of Object.keys(MCP_EVENT_ERROR_CODES)) {
      if (typeof record.message === 'string' && new RegExp(`\\b${name}\\b`).test(record.message))
        return name as McpEventErrorName;
    }
    for (const [name, code] of Object.entries(MCP_EVENT_ERROR_CODES)) {
      if (record.code === code) return name as McpEventErrorName;
    }
  }
};

export const createMcpEventError = (error: unknown) => {
  const name = getMcpEventErrorName(error);
  if (!name) return error;
  const type = name === 'Forbidden' ? 'AUTHORIZATION_ERROR' : 'VALIDATION_ERROR';
  const message = toRecord(error)?.message;
  const mapped = createMCPError(type, `MCP Events ${name}`, {
    originalError: typeof message === 'string' ? message : undefined,
  });
  return Object.assign(mapped, { cause: error, eventError: name });
};
