import { describe, expect, it } from 'vitest';

import { buildMcpEventCard } from './cardModel';
import { parseMcpEvent } from './parseMcpEvent';

const card = (inner: string, attrs: { event?: string; truncated?: string } = {}) =>
  buildMcpEventCard({ event: 'issue.created', ...attrs }, parseMcpEvent(inner));

describe('buildMcpEventCard', () => {
  it('puts a single event on the status line with no count', () => {
    const model = card(
      '<event id="a" timestamp="t">{"n":1}</event>\n<instruction>do x</instruction>',
    );

    expect(model.single?.id).toBe('a');
    expect(model.events).toEqual([]);
    expect(model.count).toBeUndefined();
    expect(model.instruction).toBe('do x');
    expect(model.onlyEventName).toBe(false);
  });

  it('counts a batch including the events it left out, and lists each one', () => {
    const model = card(
      '<event id="a" timestamp="t">{}</event>\n<event id="b" timestamp="t">{}</event>\n<omitted count="3" />',
    );

    expect(model.single).toBeUndefined();
    expect(model.count).toEqual({ omitted: 3, total: 5 });
    expect(model.events.map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('does not treat one listed event as single when others were left out', () => {
    const model = card('<event id="a" timestamp="t">{}</event>\n<omitted count="2" />');

    expect(model.single).toBeUndefined();
    expect(model.count).toEqual({ omitted: 2, total: 3 });
  });

  it('names the event on the notice line when the notice is all there is', () => {
    const model = card('<notice kind="subscription_terminated" reason="access_revoked" />');

    expect(model.notice).toEqual({
      kind: 'subscription_terminated',
      namesEvent: true,
      reason: 'access_revoked',
    });
    expect(model.onlyEventName).toBe(false);
  });

  it('leaves the event name to the event rows when a notice comes with events', () => {
    const model = card(
      '<event id="a" timestamp="t">{}</event>\n<notice kind="subscription_terminated" />',
    );

    expect(model.notice).toEqual({
      kind: 'subscription_terminated',
      namesEvent: false,
      reason: 'unknown',
    });
  });

  it('marks a possible gap', () => {
    expect(card('', { truncated: 'true' }).truncated).toBe(true);
    expect(card('').truncated).toBe(false);
  });

  it('keeps the event pill for a block with neither events nor a notice', () => {
    expect(card('<instruction>x</instruction>').onlyEventName).toBe(true);
    expect(card('', { event: '' }).onlyEventName).toBe(false);
  });
});
