import { describe, expect, it } from 'vitest';

import { connectorSupportsEvents } from './connectorCapabilities';

describe('connectorSupportsEvents', () => {
  it('is true only when the synced capability says so', () => {
    expect(
      connectorSupportsEvents({ metadata: { capabilities: { events: { supported: true } } } }),
    ).toBe(true);
    expect(
      connectorSupportsEvents({ metadata: { capabilities: { events: { supported: false } } } }),
    ).toBe(false);
  });

  it('reads a connector synced before the capability existed as unsupported', () => {
    expect(connectorSupportsEvents({ metadata: null })).toBe(false);
    expect(connectorSupportsEvents({ metadata: {} })).toBe(false);
    expect(connectorSupportsEvents({ metadata: { capabilities: {} } })).toBe(false);
  });

  it('does not trust malformed metadata', () => {
    expect(connectorSupportsEvents({ metadata: { capabilities: 'events' } })).toBe(false);
    expect(connectorSupportsEvents({ metadata: { capabilities: { events: true } } })).toBe(false);
    expect(
      connectorSupportsEvents({ metadata: { capabilities: { events: { supported: 'yes' } } } }),
    ).toBe(false);
  });
});
