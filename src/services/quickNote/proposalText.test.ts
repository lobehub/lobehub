import { describe, expect, it } from 'vitest';

import {
  getQuickNoteProposalField,
  getQuickNoteProposalPreview,
  setQuickNoteProposalFields,
} from './proposalText';

describe('Quick Note proposal text', () => {
  /** @example Every kind shows its own title and main body. */
  it.each([
    [
      'task',
      { instruction: 'Compare gpt-live and moshi', name: 'Compare' },
      'Compare',
      'Compare gpt-live and moshi',
    ],
    ['topic', { openingMessage: 'Let us talk', title: 'Discuss' }, 'Discuss', 'Let us talk'],
    ['goal', { requirement: 'Ship v1', title: 'Launch' }, 'Launch', 'Ship v1'],
    [
      'tool_call',
      {
        apiName: 'initPage',
        arguments: { markdown: '# Plan' },
        identifier: 'lobe-page-agent',
        title: 'Plan',
      },
      'Plan',
      '# Plan',
    ],
  ] as const)('previews a %s payload', (kind, payload, title, body) => {
    expect(getQuickNoteProposalPreview(kind, payload)).toEqual({ body, title });
  });

  /** @example A goal without a requirement falls back to the problem description. */
  it('falls back to the goal problem description', () => {
    expect(
      getQuickNoteProposalPreview('goal', { problemDescription: 'Why', title: 'Goal' }).body,
    ).toBe('Why');
  });

  /** @example Missing or malformed fields read as empty text. */
  it('reads missing fields as empty', () => {
    expect(getQuickNoteProposalPreview('task', {})).toEqual({ body: '', title: '' });
    expect(getQuickNoteProposalField('tool_call', { arguments: 'bad' }, 'markdown')).toBe('');
  });

  /** @example Editing a task keeps unrelated arguments and trims values. */
  it('writes task fields while keeping other arguments', () => {
    expect(
      setQuickNoteProposalFields(
        'task',
        { extra: 1, instruction: 'Old', name: 'Old' },
        { instruction: ' New brief ', name: 'New' },
      ),
    ).toEqual({ extra: 1, instruction: 'New brief', name: 'New' });
  });

  /** @example A tool call body lives in `arguments.markdown`; an empty optional title is dropped. */
  it('writes tool call markdown into arguments', () => {
    expect(
      setQuickNoteProposalFields(
        'tool_call',
        {
          apiName: 'initPage',
          arguments: { markdown: 'Old', other: true },
          identifier: 'lobe-page-agent',
          title: 'Old',
        },
        { markdown: 'New', title: '  ' },
      ),
    ).toEqual({
      apiName: 'initPage',
      arguments: { markdown: 'New', other: true },
      identifier: 'lobe-page-agent',
    });
  });
});
