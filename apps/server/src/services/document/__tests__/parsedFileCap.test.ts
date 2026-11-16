import { describe, expect, it } from 'vitest';

import { capParsedFileDocument, PARSED_FILE_CONTENT_MAX_CHARS } from '../parsedFileCap';

describe('capParsedFileDocument', () => {
  const fileDocument = (content: string, fileType = 'txt') =>
    ({
      content,
      fileType,
      filename: 'big.txt',
      metadata: { source: 'big.txt' },
      pages: [{ charCount: content.length, lineCount: 1, metadata: {}, pageContent: content }],
      totalCharCount: content.length,
      totalLineCount: 1,
    }) as unknown as Parameters<typeof capParsedFileDocument>[0];

  it('keeps parsed text within the limit untouched', () => {
    const input = fileDocument('hello');

    expect(capParsedFileDocument(input)).toBe(input);
  });

  it('does not split a surrogate pair at the cap', () => {
    const content = `${'a'.repeat(PARSED_FILE_CONTENT_MAX_CHARS - 1)}🐛`;
    const result = capParsedFileDocument(fileDocument(content));

    expect(result.content).toBe('a'.repeat(PARSED_FILE_CONTENT_MAX_CHARS - 1));
  });

  it('closes a PDF page cut by the cap without exceeding it', () => {
    const page = (n: number, body: string) => `<page pageNumber="${n}">\n${body}\n</page>\n`;
    const content = page(1, 'first') + page(2, 'b'.repeat(PARSED_FILE_CONTENT_MAX_CHARS));
    const result = capParsedFileDocument(fileDocument(content, 'pdf'));

    expect(result.content.startsWith(page(1, 'first'))).toBe(true);
    expect(result.content.endsWith('b\n</page>')).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(PARSED_FILE_CONTENT_MAX_CHARS);
    expect(result.content.match(/<page /g)).toHaveLength(2);
    expect(result.content.match(/<\/page>/g)).toHaveLength(2);
  });

  it('drops a page opening tag cut by the cap', () => {
    const first = `<page pageNumber="1">\n${'a'.repeat(PARSED_FILE_CONTENT_MAX_CHARS - 40)}\n</page>\n`;
    const result = capParsedFileDocument(
      fileDocument(`${first}<page pageNumber="2">\nsecond\n</page>`, 'pdf'),
    );

    expect(result.content).toBe(first.trimEnd());
  });

  it('leaves a literal page tag in non-PDF text untouched', () => {
    const content = `<page title="example">\n${'c'.repeat(PARSED_FILE_CONTENT_MAX_CHARS)}`;
    const result = capParsedFileDocument(fileDocument(content));

    expect(result.content).toBe(content.slice(0, PARSED_FILE_CONTENT_MAX_CHARS));
  });

  it('truncates oversized parsed text and drops the duplicated pages', () => {
    const originalLength = PARSED_FILE_CONTENT_MAX_CHARS + 10;
    const result = capParsedFileDocument(fileDocument(`${'a\n'.repeat(originalLength / 2)}`));

    expect(result.content).toHaveLength(PARSED_FILE_CONTENT_MAX_CHARS);
    expect(result.pages).toBeUndefined();
    expect(result.totalCharCount).toBe(PARSED_FILE_CONTENT_MAX_CHARS);
    expect(result.totalLineCount).toBe(PARSED_FILE_CONTENT_MAX_CHARS / 2 + 1);
    expect(result.metadata).toMatchObject({
      originalCharCount: originalLength,
      source: 'big.txt',
      truncated: true,
    });
  });
});
