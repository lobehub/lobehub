import { describe, expect, it } from 'vitest';

import { getWebhookEventSource, parseWebhookEvent } from './parseWebhookEvent';

const block = [
  '<webhookEvent webhookId="wh-1" name="CI &quot;alerts&quot;" thread="PR-7">',
  '<event id="s1" timestamp="2026-11-13T08:00:00Z" test="true">{"body":{"n":1}}</event>',
  '<event id="s2" timestamp="2026-11-13T08:00:01Z">{"body":"&lt;b&gt;"}</event>',
  '<omitted count="3" />',
  '<guidance>Never shown.</guidance>',
  '<instruction>Triage it</instruction>',
  '</webhookEvent>',
].join('\n');

describe('getWebhookEventSource', () => {
  it('reads the webhook from a message that opens with the block', () => {
    expect(getWebhookEventSource(block)).toEqual({
      name: 'CI "alerts"',
      thread: 'PR-7',
      webhookId: 'wh-1',
    });
  });

  it('ignores a message that only quotes the tag later on', () => {
    expect(getWebhookEventSource(`look: ${block}`)).toBeUndefined();
    expect(getWebhookEventSource('')).toBeUndefined();
  });
});

describe('parseWebhookEvent', () => {
  it('reads events, test flags, the omitted count and the instruction, never the guidance', () => {
    const parsed = parseWebhookEvent(block);
    expect(parsed.events.map((event) => event.id)).toEqual(['s1', 's2']);
    expect(parsed.events[1].data).toBe('{"body":"<b>"}');
    expect([...parsed.testIds]).toEqual(['s1']);
    expect(parsed.omitted).toBe(3);
    expect(parsed.instruction).toBe('Triage it');
  });
});
