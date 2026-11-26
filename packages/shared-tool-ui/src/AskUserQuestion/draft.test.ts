import { describe, expect, it } from 'vitest';

import { readDraft, resolvePrimaryAction } from './draft';
import type { AskUserQuestionItem } from './types';

const questions: AskUserQuestionItem[] = [
  { header: 'Audience', options: [{ label: 'Owners' }, { label: 'Everyone' }], question: 'Who?' },
  {
    header: 'Content',
    multiSelect: true,
    options: [{ label: 'Runs' }, { label: 'Credits' }],
    question: 'What?',
  },
  { header: 'Schedule', options: [{ label: 'Monday' }, { label: 'Friday' }], question: 'When?' },
];

const base = { custom: {}, noteText: '', picks: {}, questions, requireAllAnswered: true };

describe('resolvePrimaryAction', () => {
  it('submits once every question is answered', () => {
    const picks = { What: ['Runs'], When: 'Monday', Who: 'Owners' };
    expect(
      resolvePrimaryAction({
        ...base,
        activeIndex: 2,
        picks: { 'What?': picks.What, 'When?': picks.When, 'Who?': picks.Who },
      }),
    ).toEqual({ action: { kind: 'submit' }, enabled: true });
  });

  it('offers Next to the following unanswered question once the active one is answered', () => {
    expect(resolvePrimaryAction({ ...base, activeIndex: 0, picks: { 'Who?': 'Owners' } })).toEqual({
      action: { index: 1, kind: 'next' },
      enabled: true,
    });
  });

  it('shows Next disabled while the active question is still unanswered', () => {
    expect(resolvePrimaryAction({ ...base, activeIndex: 0 })).toEqual({
      action: { index: 1, kind: 'next' },
      enabled: false,
    });
  });

  it('wraps Next around to an earlier unanswered question', () => {
    expect(
      resolvePrimaryAction({
        ...base,
        activeIndex: 2,
        picks: { 'What?': ['Runs'], 'When?': 'Monday' },
      }),
    ).toEqual({ action: { index: 0, kind: 'next' }, enabled: true });
  });

  it('falls back to a disabled Submit when only the active question is left', () => {
    expect(
      resolvePrimaryAction({
        ...base,
        activeIndex: 2,
        picks: { 'What?': ['Runs'], 'Who?': 'Owners' },
      }),
    ).toEqual({ action: { kind: 'submit' }, enabled: false });
  });

  it('sends the note on its own when nothing is answered', () => {
    expect(resolvePrimaryAction({ ...base, activeIndex: 0, noteText: 'Hold off.' })).toEqual({
      action: { kind: 'sendNote' },
      enabled: true,
    });
  });

  it('keeps Next when a note rides along with partial answers', () => {
    expect(
      resolvePrimaryAction({
        ...base,
        activeIndex: 0,
        noteText: 'Context',
        picks: { 'Who?': 'Owners' },
      }),
    ).toEqual({ action: { index: 1, kind: 'next' }, enabled: true });
  });

  it('submits a partial answer when every question is optional', () => {
    expect(
      resolvePrimaryAction({
        ...base,
        activeIndex: 0,
        picks: { 'Who?': 'Owners' },
        requireAllAnswered: false,
      }),
    ).toEqual({ action: { kind: 'submit' }, enabled: true });
  });
});

describe('readDraft', () => {
  it('moves a legacy replace-all answer into the note', () => {
    expect(readDraft({ escapeActive: true, escapeText: 'Do it differently.' })).toMatchObject({
      escapeActive: false,
      escapeText: '',
      supplementActive: true,
      supplementText: 'Do it differently.',
    });
  });
});
