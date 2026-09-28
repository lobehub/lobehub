import { describe, expect, it } from 'vitest';

import { buildCaptureDraft, toPlainText } from './buildCaptureDraft';

const msg = (id: string, role: string, content: unknown) => ({ content, id, role });

describe('toPlainText', () => {
  it('passes a string through', () => {
    expect(toPlainText('hi')).toBe('hi');
  });

  it('joins content parts and drops the ones with no text', () => {
    expect(toPlainText([{ text: 'a' }, 'b', { image: 'x' }])).toBe('a\nb');
  });

  it('returns an empty string for content it cannot read', () => {
    expect(toPlainText(undefined)).toBe('');
    expect(toPlainText({ odd: 1 })).toBe('');
  });
});

describe('buildCaptureDraft', () => {
  const conversation = [
    msg('m1', 'system', 'you are helpful'),
    msg('m2', 'user', 'first question'),
    msg('m3', 'assistant', 'first answer'),
    msg('m4', 'user', 'second question'),
    msg('m5', 'assistant', 'second answer'),
  ];

  it('slices the answer, the turn that asked for it, and everything before as context', () => {
    const draft = buildCaptureDraft(conversation, 'm5')!;

    expect(draft.input).toBe('second question');
    expect(draft.actualOutput).toBe('second answer');
    expect(draft.context).toEqual([
      { content: 'first question', role: 'user' },
      { content: 'first answer', role: 'assistant' },
    ]);
  });

  it('drops the system message, which is harness context rather than a turn', () => {
    expect(buildCaptureDraft(conversation, 'm5')!.context.some((c) => c.role === 'system')).toBe(
      false,
    );
  });

  it('captures the first answer with no context at all', () => {
    const draft = buildCaptureDraft(conversation, 'm3')!;

    expect(draft.input).toBe('first question');
    expect(draft.context).toEqual([]);
  });

  it('refuses an answer with no user turn before it rather than inventing an input', () => {
    expect(buildCaptureDraft([msg('a1', 'assistant', 'orphan answer')], 'a1')).toBeUndefined();
  });

  it('refuses when the preceding user turn is empty', () => {
    const messages = [msg('u', 'user', '   '), msg('a', 'assistant', 'answer')];
    expect(buildCaptureDraft(messages, 'a')).toBeUndefined();
  });

  it('refuses a non-assistant target', () => {
    expect(buildCaptureDraft(conversation, 'm4')).toBeUndefined();
  });

  it('returns undefined for an unknown message id', () => {
    expect(buildCaptureDraft(conversation, 'nope')).toBeUndefined();
  });

  it('skips blank context turns but keeps the ones with content', () => {
    const messages = [
      msg('m1', 'assistant', ''),
      msg('m2', 'user', 'kept'),
      msg('m3', 'user', 'the question'),
      msg('m4', 'assistant', 'the answer'),
    ];

    expect(buildCaptureDraft(messages, 'm4')!.context).toEqual([{ content: 'kept', role: 'user' }]);
  });
});
