import { describe, expect, it } from 'vitest';

import {
  GENERIC_WEBHOOK_IDENTIFIER_PATTERN,
  genericWebhookIdentifierFromName,
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
