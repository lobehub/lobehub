import superjson from 'superjson';

export interface McpIpcPayload<T = unknown> {
  json: T;
  meta?: unknown;
}

export const serializeMcpIpcPayload = <T>(payload: T): McpIpcPayload<T> => ({
  json: JSON.parse(JSON.stringify(payload ?? null)) as T,
});

export const deserializeMcpIpcPayload = <T>(payload: unknown): T => {
  if (!payload || typeof payload !== 'object' || !('json' in payload)) return payload as T;
  const envelope = payload as McpIpcPayload<T>;
  // Older builds superjson-serialize this envelope; `meta` only exists there.
  if (envelope.meta) return superjson.deserialize(envelope as never) as T;
  return envelope.json;
};
