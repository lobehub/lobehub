import { describe, expect, it } from 'vitest';

import {
  GENERIC_WEBHOOK_IDENTIFIER_PATTERN,
  genericWebhookIdentifierFromName,
  genericWebhookIdentifierOf,
  uniqueGenericWebhookIdentifier,
} from './inboundWebhook';

describe('genericWebhookIdentifierFromName', () => {
  it.each([
    ['CI alerts', 'ci-alerts'],
    ['  GitHub → PR #42 ', 'github-pr-42'],
    ['Café déjà vu', 'cafe-deja-vu'],
    ['告警通知', 'webhook'],
    ['', 'webhook'],
    [null, 'webhook'],
    [`${'a'.repeat(47)} b`, 'a'.repeat(47)],
  ])('%j → %s', (name, expected) => {
    const identifier = genericWebhookIdentifierFromName(name);
    expect(identifier).toBe(expected);
    expect(identifier).toMatch(GENERIC_WEBHOOK_IDENTIFIER_PATTERN);
  });
});

describe('uniqueGenericWebhookIdentifier', () => {
  it('numbers an identifier the agent already uses', () => {
    expect(uniqueGenericWebhookIdentifier('webhook', new Set())).toBe('webhook');
    expect(uniqueGenericWebhookIdentifier('webhook', new Set(['webhook']))).toBe('webhook-2');
    expect(uniqueGenericWebhookIdentifier('webhook', new Set(['webhook', 'webhook-2']))).toBe(
      'webhook-3',
    );
  });

  it('stays within the length limit', () => {
    const base = 'a'.repeat(48);
    const next = uniqueGenericWebhookIdentifier(base, new Set([base]));
    expect(next).toBe(`${'a'.repeat(46)}-2`);
    expect(next).toMatch(GENERIC_WEBHOOK_IDENTIFIER_PATTERN);
  });
});

describe('genericWebhookIdentifierOf', () => {
  it('reads the stored identifier, or a distinct one for webhooks made before identifiers', () => {
    expect(genericWebhookIdentifierOf({ config: { identifier: 'ci' }, id: 'x' })).toBe('ci');
    expect(
      genericWebhookIdentifierOf({ config: {}, id: '0b6f3c2a-1111-2222-3333-444455556666' }),
    ).toBe('webhook-0b6f3c2a');
  });
});
