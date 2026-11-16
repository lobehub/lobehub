import { describe, expect, it } from 'vitest';

import {
  formatWebhookCallData,
  getWebhookEventSource,
  parseWebhookEvent,
} from './parseWebhookEvent';

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

describe('formatWebhookCallData', () => {
  it('previews what the caller sent and expands to the whole delivery', () => {
    const data = JSON.stringify({ body: 'disk\nfull', headers: { 'user-agent': 'curl' } });
    const formatted = formatWebhookCallData(data);
    expect(formatted.preview).toBe('disk full');
    expect(formatted.pretty).toContain('"user-agent": "curl"');
    expect(formatWebhookCallData(JSON.stringify({ body: { build: 42 } })).preview).toBe(
      '{"build":42}',
    );
  });

  it('shows data that is not a delivery as written', () => {
    expect(formatWebhookCallData('not json').preview).toBe('not json');
    expect(formatWebhookCallData('{"other":1}').preview).toBe('{"other":1}');
  });
});
