import { describe, expect, it } from 'vitest';

import { resolveAutomationsGate } from './gate';

describe('resolveAutomationsGate', () => {
  it('waits for the server config before reading the flag', () => {
    expect(resolveAutomationsGate({ enableWebhook: false, serverConfigInit: false })).toBe(
      'loading',
    );
    expect(resolveAutomationsGate({ enableWebhook: true, serverConfigInit: false })).toBe(
      'loading',
    );
  });

  it('is a 404 while webhooks are off, and the page once it is on', () => {
    expect(resolveAutomationsGate({ enableWebhook: false, serverConfigInit: true })).toBe(
      'notFound',
    );
    expect(resolveAutomationsGate({ enableWebhook: true, serverConfigInit: true })).toBe('ready');
  });
});
