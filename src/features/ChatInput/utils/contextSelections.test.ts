import { describe, expect, it } from 'vitest';

import { buildMessageContextSelections } from './contextSelections';

describe('buildMessageContextSelections', () => {
  it('preserves exact selected text separately from its block XML and shortened preview', () => {
    const content = ' a<b\n  and c>d ';
    const xml = '<p id="ab12">Before a&lt;b and c&gt;d after</p>';
    const result = buildMessageContextSelections([
      { content, xml, preview: 'a and c>d', id: 'sel-1', pageId: 'page-1', type: 'text' },
    ]);

    expect(result.contextSelections[0]).toMatchObject({ content, xml });
    expect(result.pageSelections[0]).toMatchObject({ content, xml });
  });
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
