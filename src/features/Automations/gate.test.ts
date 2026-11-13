import { describe, expect, it } from 'vitest';

import { resolveAutomationsGate } from './gate';

describe('resolveAutomationsGate', () => {
  it('waits for the server config before reading the flag', () => {
    expect(resolveAutomationsGate({ enableMcpEvents: false, serverConfigInit: false })).toBe(
      'loading',
    );
    expect(resolveAutomationsGate({ enableMcpEvents: true, serverConfigInit: false })).toBe(
      'loading',
    );
  });

  it('is a 404 while MCP Events is off, and the page once it is on', () => {
    expect(resolveAutomationsGate({ enableMcpEvents: false, serverConfigInit: true })).toBe(
      'notFound',
    );
    expect(resolveAutomationsGate({ enableMcpEvents: true, serverConfigInit: true })).toBe('ready');
  });
});
