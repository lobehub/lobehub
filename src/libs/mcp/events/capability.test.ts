import { describe, expect, it } from 'vitest';

import { getEventsCapability } from './capability';
import { MCP_EVENTS_EXTENSION_ID } from './schema';

describe('events capability', () => {
  it('requires a modern session and a settings object', () => {
    expect(
      getEventsCapability({ extensions: { [MCP_EVENTS_EXTENSION_ID]: {} } }, 'modern').supported,
    ).toBe(true);
    expect(getEventsCapability({ events: { listChanged: true } }, 'modern')).toEqual({
      supported: true,
      listChanged: true,
    });
    expect(getEventsCapability({ events: {} }, 'legacy')).toEqual({ supported: false });
    for (const value of [undefined, null, true, 'yes', []])
      expect(getEventsCapability({ events: value }, 'modern').supported).toBe(false);
  });
});
