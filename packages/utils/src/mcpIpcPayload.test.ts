import superjson from 'superjson';
import { describe, expect, it } from 'vitest';

import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from './mcpIpcPayload';

describe('mcpIpcPayload', () => {
  it('round-trips schemas containing prototype/constructor keys', () => {
    const manifest = {
      api: [
        {
          name: 'set_function_prototype',
          parameters: {
            properties: {
              constructor: { type: 'string' },
              prototype: { type: 'string' },
            },
            type: 'object',
          },
        },
      ],
      identifier: 'idalib-mcp',
    };

    expect(() => superjson.serialize(manifest)).toThrow(/prototype/);

    const envelope = serializeMcpIpcPayload(manifest);
    expect(deserializeMcpIpcPayload(envelope)).toEqual(manifest);
  });

  it('strips undefined values like superjson json output', () => {
    const envelope = serializeMcpIpcPayload({ a: 1, b: undefined });
    expect(envelope.json).toEqual({ a: 1 });
  });

  it('deserializes legacy superjson envelopes with meta', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const legacy = superjson.serialize({ createdAt: date, name: 'x' });
    expect(legacy.meta).toBeTruthy();

    const result = deserializeMcpIpcPayload<{ createdAt: Date; name: string }>(legacy);
    expect(result.createdAt).toEqual(date);
    expect(result.name).toBe('x');
  });

  it('passes through non-envelope payloads', () => {
    expect(deserializeMcpIpcPayload({ command: 'uv' })).toEqual({ command: 'uv' });
    expect(deserializeMcpIpcPayload(undefined)).toBeUndefined();
  });
});
