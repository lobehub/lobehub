import { describe, expect, it } from 'vitest';

import { buildTranscript, toText } from './buildTranscript';

describe('toText', () => {
  it('passes a plain string through', () => {
    expect(toText('hello')).toBe('hello');
  });

  it('flattens provider content parts', () => {
    expect(toText([{ text: 'part one', type: 'text' }, 'part two'])).toBe('part one\npart two');
  });

  it('drops parts with no text rather than stringifying them', () => {
    expect(toText([{ image: 'x' }, { text: 'kept' }])).toBe('kept');
  });

  it('returns an empty string for content it cannot read', () => {
    expect(toText({ odd: true })).toBe('');
    expect(toText(undefined)).toBe('');
    expect(toText(null)).toBe('');
  });
});

describe('buildTranscript', () => {
  it('returns no context and no boundary when the case has none', () => {
    expect(buildTranscript()).toEqual({ context: [], hasBoundary: false });
    expect(buildTranscript([])).toEqual({ context: [], hasBoundary: false });
  });

  it('keeps user and assistant turns in order', () => {
    const result = buildTranscript([
      { content: 'first', role: 'user' },
      { content: 'second', role: 'assistant' },
    ]);

    expect(result.context).toEqual([
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'second' },
    ]);
    expect(result.hasBoundary).toBe(true);
  });

  it('drops the system message, which is harness context rather than a turn', () => {
    const result = buildTranscript([
      { content: 'you are helpful', role: 'system' },
      { content: 'earlier', role: 'user' },
    ]);

    expect(result.context).toEqual([{ role: 'user', text: 'earlier' }]);
  });

  it('reports no boundary when system messages were the only context', () => {
    expect(buildTranscript([{ content: 'sys', role: 'system' }])).toEqual({
      context: [],
      hasBoundary: false,
    });
  });

  it('defaults a missing role to user', () => {
    expect(buildTranscript([{ content: 'x' }]).context).toEqual([{ role: 'user', text: 'x' }]);
  });
});
