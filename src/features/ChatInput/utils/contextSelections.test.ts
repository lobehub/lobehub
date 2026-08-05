import { describe, expect, it } from 'vitest';

import { buildMessageContextSelections } from './contextSelections';

describe('buildMessageContextSelections', () => {
  it('derives generic and legacy selections for page context', () => {
    const result = buildMessageContextSelections([
      {
        content: '<p>Selected paragraph</p>',
        format: 'xml',
        id: 'sel-1',
        pageId: 'page-1',
        preview: 'Selected paragraph',
        title: 'Selection',
        type: 'text',
      },
    ]);

    expect(result.contextSelections).toEqual([
      expect.objectContaining({
        content: 'Selected paragraph',
        id: 'sel-1',
        pageId: 'page-1',
        source: 'page',
        xml: '<p>Selected paragraph</p>',
      }),
    ]);
    expect(result.pageSelections).toEqual([
      expect.objectContaining({
        content: 'Selected paragraph',
        id: 'sel-1',
        pageId: 'page-1',
        xml: '<p>Selected paragraph</p>',
      }),
    ]);
  });

  it('keeps code context out of legacy page selections', () => {
    const result = buildMessageContextSelections([
      {
        content: 'const value = 1;',
        filePath: 'src/example.ts',
        id: 'code-1',
        language: 'ts',
        lineRange: { endLine: 12, startLine: 12 },
        side: 'additions',
        source: 'code',
        type: 'text',
      },
    ]);

    expect(result.contextSelections).toEqual([
      expect.objectContaining({
        content: 'const value = 1;',
        filePath: 'src/example.ts',
        language: 'ts',
        lineRange: { endLine: 12, startLine: 12 },
        side: 'additions',
        source: 'code',
      }),
    ]);
    expect(result.pageSelections).toEqual([]);
  });
});
