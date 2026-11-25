import { describe, expect, it } from 'vitest';

import {
  channelAskAnswerText,
  channelAskFallbackText,
  channelAskInterventionResult,
  channelMessageAsk,
  normalizeChannelAskInput,
  validateChannelAskAnswers,
} from './channelAsk';

const ask = {
  questions: [
    { options: [{ label: 'Diet' }, { label: 'Exercise' }], question: 'Start with?' },
    {
      multiSelect: true,
      options: [{ label: 'Mornings' }, { label: 'Evenings' }],
      question: 'When?',
    },
  ],
};

describe('channel ask', () => {
  it('normalizes what an Agent asks and refuses what a card cannot show', () => {
    expect(
      normalizeChannelAskInput({
        questions: [{ options: [{ label: ' A ' }, { label: 'B' }], question: ' Pick ' }],
      }),
    ).toEqual({ questions: [{ options: [{ label: 'A' }, { label: 'B' }], question: 'Pick' }] });
    expect(() =>
      normalizeChannelAskInput({ questions: [{ options: [{ label: 'A' }], question: 'Q' }] }),
    ).toThrow('between 2 and 6 options');
    expect(() =>
      normalizeChannelAskInput({
        questions: [{ options: [{ label: 'A' }, { label: 'A' }], question: 'Q' }],
      }),
    ).toThrow('duplicate options');
    expect(() => normalizeChannelAskInput({ questions: [] })).toThrow('between 1 and 4');
  });

  it('writes the questions and an answer as plain text', () => {
    expect(channelAskFallbackText(ask)).toBe(
      'Start with?\nA. Diet\nB. Exercise\n\nWhen? (multiple choice)\nA. Mornings\nB. Evenings',
    );
    expect(
      channelAskAnswerText(ask, [
        { selected: ['Exercise'] },
        { other: 'Weekends', selected: ['Mornings'] },
      ]),
    ).toBe('Start with?\nB. Exercise\n\nWhen?\nA. Mornings; Weekends');
  });

  it('checks an answer against its questions', () => {
    const valid = [{ selected: ['Diet'] }, { selected: ['Mornings', 'Evenings'] }];
    expect(validateChannelAskAnswers(ask, valid)).toBeUndefined();
    expect(validateChannelAskAnswers(ask, [valid[0]])).toBe('Answer every question');
    expect(validateChannelAskAnswers(ask, [{ selected: ['Diet', 'Exercise'] }, valid[1]])).toMatch(
      'takes one answer',
    );
    expect(validateChannelAskAnswers(ask, [{ other: 'Sleep', selected: [] }, valid[1]])).toBe(
      undefined,
    );
    expect(validateChannelAskAnswers(ask, [{ selected: [] }, valid[1]])).toMatch('no answer');
    expect(validateChannelAskAnswers(ask, [{ selected: ['Sleep'] }, valid[1]])).toMatch(
      'pick from its options',
    );
  });

  it('reads metadata.ask defensively', () => {
    expect(channelMessageAsk({})).toBeUndefined();
    expect(
      channelMessageAsk({ ask: { ...ask, bodyLength: 3, requesterMemberId: 'm', status: 'x' } }),
    ).toMatchObject({ bodyLength: 3, status: 'pending' });
  });

  it('reads closed cards and the run a card belongs to', () => {
    const intervention = { operationId: 'op-1', toolCallId: 'toolu_1' };
    expect(
      channelMessageAsk({
        ask: { ...ask, intervention, requesterMemberId: 'm1', status: 'closed' },
      }),
    ).toMatchObject({ intervention, status: 'closed' });
    expect(
      channelMessageAsk({ ask: { ...ask, requesterMemberId: 'm1', status: 'nope' } })?.status,
    ).toBe('pending');
  });

  it('shapes an answer the way a blocked run reads its question card', () => {
    expect(
      channelAskInterventionResult(ask, [
        { selected: ['Exercise'] },
        { other: ' Weekends ', selected: ['Mornings'] },
      ]),
    ).toEqual({ 'Start with?': 'Exercise', 'When?': ['Mornings', 'Weekends'] });
    expect(
      channelAskInterventionResult(ask, [{ other: 'Sleep', selected: [] }, { selected: [] }]),
    ).toEqual({ 'Start with?': 'Sleep', 'When?': [] });
  });
});
