import { describe, expect, it } from 'vitest';

import { McpListEventsResultSchema, McpSubscribeEventResultSchema } from './schema';

describe('McpSubscribeEventResultSchema', () => {
  // Verbatim from the mcp-webhook-events reference server, for a subscription that has not had a
  // successful delivery yet. Go servers emit `null` for unset optional fields.
  const neverDelivered = {
    _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'mcp-webhook-events' } },
    cursor: 'bXdlMToyOA',
    deliveryStatus: {
      active: true,
      failedSince: '2026-11-13T17:28:03.389Z',
      lastDeliveryAt: null,
      lastError: 'http_5xx',
    },
    id: 'sub_0125bd3996265f46ca6e9e24',
    refreshBefore: '2026-11-13T17:32:22.756Z',
    resultType: 'complete',
    truncated: false,
  };

  it('accepts null for optional delivery status fields and reads them as absent', () => {
    const result = McpSubscribeEventResultSchema.parse(neverDelivered);

    expect(result.id).toBe('sub_0125bd3996265f46ca6e9e24');
    expect(result.deliveryStatus).toEqual({
      active: true,
      failedSince: '2026-11-13T17:28:03.389Z',
      lastError: 'http_5xx',
    });
    expect(result.deliveryStatus?.lastDeliveryAt).toBeUndefined();
    // What gets persisted must not carry the null: the stored state schema is strict.
    expect(JSON.stringify(result.deliveryStatus)).not.toContain('lastDeliveryAt');
  });

  it('keeps an explicit null lastError, which the spec uses for a healthy subscription', () => {
    const result = McpSubscribeEventResultSchema.parse({
      ...neverDelivered,
      deliveryStatus: { active: true, lastDeliveryAt: '2026-11-13T17:28:00Z', lastError: null },
    });

    expect(result.deliveryStatus).toEqual({
      active: true,
      lastDeliveryAt: '2026-11-13T17:28:00Z',
      lastError: null,
    });
  });

  it('treats null for the optional top-level fields as absent', () => {
    const result = McpSubscribeEventResultSchema.parse({
      deliveryStatus: null,
      id: 'sub_1',
      refreshBefore: null,
      truncated: null,
    });

    expect(result.refreshBefore).toBeNull();
    expect(result.deliveryStatus).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });

  it('drops a malformed delivery status instead of failing a subscription that succeeded', () => {
    const result = McpSubscribeEventResultSchema.parse({
      deliveryStatus: { active: 'yes' },
      id: 'sub_1',
      refreshBefore: null,
    });

    expect(result.id).toBe('sub_1');
    expect(result.deliveryStatus).toBeUndefined();
  });

  it('still rejects a response without the subscription id', () => {
    expect(() => McpSubscribeEventResultSchema.parse({ refreshBefore: null })).toThrow();
  });
});

describe('McpListEventsResultSchema', () => {
  it('treats null for optional event type fields as absent', () => {
    const result = McpListEventsResultSchema.parse({
      events: [
        {
          delivery: ['webhook'],
          description: null,
          inputSchema: null,
          name: 'issue.created',
          payloadSchema: null,
          title: null,
        },
      ],
      nextCursor: null,
    });

    expect(result.nextCursor).toBeUndefined();
    expect(result.events[0]).toEqual({ delivery: ['webhook'], name: 'issue.created' });
  });
});
