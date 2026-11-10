import { describe, expect, it } from 'vitest';

import { parseOpenCodeReadContent } from './parseReadContent';

describe('parseOpenCodeReadContent', () => {
  it('extracts the header path and strips OpenCode line numbers and the end marker', () => {
    const result = parseOpenCodeReadContent(`<path>/repo/src/index.ts</path>
<type>file</type>
<content>
1: const value = 1;
2:
3: export default value;

(End of file - total 3 lines)
</content>`);

    expect(result).toEqual({
      content: 'const value = 1;\n\nexport default value;',
      hasEnvelope: true,
      path: '/repo/src/index.ts',
    });
  });

  it('removes a continuation marker from a partial read', () => {
    const result = parseOpenCodeReadContent(`<path>/repo/large.txt</path>
<content>
20: first
21: second

(Showing lines 20-21 of 100. Use offset=22 to continue.)
</content>`);

    expect(result.content).toBe('first\nsecond');
  });

  it('returns empty content for a marker-only payload from an empty file', () => {
    const result = parseOpenCodeReadContent(`<path>/repo/empty.txt</path>
<content>
(End of file - total 0 lines)
</content>`);

    expect(result).toEqual({ content: '', hasEnvelope: true, path: '/repo/empty.txt' });
  });

  it('returns empty content for a marker-only continuation payload', () => {
    const result = parseOpenCodeReadContent(`<content>
(Showing lines 50-50 of 10. Use offset=1 to continue.)
</content>`);

    expect(result.content).toBe('');
  });

  it('keeps a literal </content> inside the file body', () => {
    const result = parseOpenCodeReadContent(`<path>/repo/envelope.xml</path>
<content>
1: <content>inner</content>
2: tail line

(End of file - total 2 lines)
</content>`);

    expect(result).toEqual({
      content: '<content>inner</content>\ntail line',
      hasEnvelope: true,
      path: '/repo/envelope.xml',
    });
  });

  it('preserves unnumbered content that contains a numeric-colon line', () => {
    const result = parseOpenCodeReadContent(`<content>
42: this is file content
plain line
</content>`);

    expect(result).toEqual({
      content: '42: this is file content\nplain line',
      hasEnvelope: true,
      path: undefined,
    });
  });

  it('does not treat a path tag inside the file body as header metadata', () => {
    const result = parseOpenCodeReadContent(`<content>
plain line
<path>/not/metadata</path>
</content>`);

    expect(result).toEqual({
      content: 'plain line\n<path>/not/metadata</path>',
      hasEnvelope: true,
      path: undefined,
    });
  });

  it.each([
    [
      'Read file /repo/long.txt, lines 10-12\n10: row 10\n11: row 11\n12: row 12\n[Output truncated. Continue reading with offset: 13]',
      { content: 'row 10\nrow 11\nrow 12', hasEnvelope: true, path: '/repo/long.txt' },
    ],
    [
      'Read file /repo/a, lines 1.txt, lines 1-1\n1: hello',
      { content: 'hello', hasEnvelope: true, path: '/repo/a, lines 1.txt' },
    ],
    [
      'Read file /repo/empty.txt, 0 lines',
      { content: '', hasEnvelope: true, path: '/repo/empty.txt' },
    ],
  ])('parses the OpenCode 2.x read header %#', (raw, expected) => {
    expect(parseOpenCodeReadContent(raw)).toEqual(expected);
  });

  it('leaves content without a complete OpenCode envelope unchanged', () => {
    expect(parseOpenCodeReadContent('raw file content')).toEqual({ content: 'raw file content' });
    expect(parseOpenCodeReadContent('<content>unterminated')).toEqual({
      content: '<content>unterminated',
    });
  });
});
