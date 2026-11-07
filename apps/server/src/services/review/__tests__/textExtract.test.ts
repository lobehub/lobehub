// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { textFromEditorData } from '../textExtract';

const paragraph = (text: string) => ({
  children: [{ text, type: 'text' }],
  type: 'paragraph',
});

describe('textFromEditorData with pending edits', () => {
  it('reads the accepted wording of a pending modification, not both versions', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [
              paragraph('The fee is due within 90 days.'),
              paragraph('The fee is due within 30 days.'),
            ],
            diffType: 'modify',
            type: 'diff',
          },
        ],
        type: 'root',
      },
    };

    expect(textFromEditorData(editorData)).toBe('The fee is due within 90 days.');
  });

  it('leaves an unaccepted addition out of the text the checker reads', () => {
    const editorData = {
      root: {
        children: [
          paragraph('The fee is due within 90 days.'),
          {
            children: [paragraph('Insurance is required.')],
            diffType: 'add',
            type: 'diff',
          },
        ],
        type: 'root',
      },
    };

    const text = textFromEditorData(editorData);

    expect(text).toBe('The fee is due within 90 days.');
    expect(text).not.toContain('Insurance');
  });

  it('keeps a pending removal, which the accepted document still shows', () => {
    const editorData = {
      root: {
        children: [
          {
            children: [paragraph('The fee is due within 90 days.')],
            diffType: 'remove',
            type: 'diff',
          },
        ],
        type: 'root',
      },
    };

    expect(textFromEditorData(editorData)).toBe('The fee is due within 90 days.');
  });
});
