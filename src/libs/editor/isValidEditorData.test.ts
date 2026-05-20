import { describe, expect, it } from 'vitest';

import { isValidEditorData } from './isValidEditorData';

describe('isValidEditorData', () => {
  it('should reject empty or incomplete editor data', () => {
    expect(isValidEditorData(null)).toBe(false);
    expect(isValidEditorData({})).toBe(false);
    expect(isValidEditorData({ root: { children: [] } })).toBe(false);
    expect(
      isValidEditorData({
        root: {
          children: [],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      }),
    ).toBe(false);
  });

  it('should accept non-empty Lexical editor data', () => {
    expect(
      isValidEditorData({
        root: {
          children: [
            {
              children: [
                {
                  detail: 0,
                  format: 0,
                  mode: 'normal',
                  style: '',
                  text: 'hello',
                  type: 'text',
                  version: 1,
                },
              ],
              direction: 'ltr',
              format: '',
              indent: 0,
              type: 'paragraph',
              version: 1,
            },
          ],
          direction: 'ltr',
          format: '',
          indent: 0,
          type: 'root',
          version: 1,
        },
      }),
    ).toBe(true);
  });
});
