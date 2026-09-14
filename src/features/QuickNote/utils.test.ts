import { describe, expect, it } from 'vitest';

import { getNoteTitle, resolveNoteEditorContent } from './utils';

describe('resolveNoteEditorContent', () => {
  it('uses the text type for an empty note so Lexical never receives an empty root', () => {
    expect(resolveNoteEditorContent('')).toEqual({ content: '', type: 'text' });
    expect(resolveNoteEditorContent('随手记一条')).toEqual({
      content: '随手记一条',
      type: 'markdown',
    });
  });
});

describe('getNoteTitle', () => {
  it('returns the first non-empty line', () => {
    expect(getNoteTitle('\n\n  \n第一行\n第二行')).toBe('第一行');
    expect(getNoteTitle('')).toBe('');
  });
});
