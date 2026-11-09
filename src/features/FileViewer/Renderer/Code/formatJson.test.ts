import { describe, expect, it } from 'vitest';

import { formatJsonForPreview } from './formatJson';

describe('formatJsonForPreview', () => {
  it('indents a minified JSON document', () => {
    const input =
      '{"id":"speech-2.8-hd","type":"tts","pricing":{"units":[{"rate":100}]},"tags":[]}';

    expect(formatJsonForPreview(input, 'json')).toBe(
      [
        '{',
        '  "id": "speech-2.8-hd",',
        '  "type": "tts",',
        '  "pricing": {',
        '    "units": [',
        '      {',
        '        "rate": 100',
        '      }',
        '    ]',
        '  },',
        '  "tags": []',
        '}',
      ].join('\n'),
    );
  });

  it('matches JSON.stringify indentation for ordinary values', () => {
    const value = { a: [1, true, null, { b: 'x' }], c: {}, d: -1.5e3, e: '' };
    const input = JSON.stringify(value);

    expect(formatJsonForPreview(input, 'json')).toBe(JSON.stringify(value, null, 2));
  });

  it('keeps structural characters and escapes inside strings untouched', () => {
    const input = String.raw`{"text":"a, b: {c} [d] \"quoted\" \\","path":"C:\\dir"}`;

    const output = formatJsonForPreview(input, 'json');

    expect(output).toBe(
      [
        '{',
        String.raw`  "text": "a, b: {c} [d] \"quoted\" \\",`,
        String.raw`  "path": "C:\\dir"`,
        '}',
      ].join('\n'),
    );
    expect(JSON.parse(output)).toEqual(JSON.parse(input));
  });

  it('preserves number literals that JSON.stringify would rewrite', () => {
    const input = '{"id":12345678901234567890,"ratio":1.0,"tiny":1E-7}';

    expect(formatJsonForPreview(input, 'json')).toBe(
      ['{', '  "id": 12345678901234567890,', '  "ratio": 1.0,', '  "tiny": 1E-7', '}'].join('\n'),
    );
  });

  it('formats a minified document with a trailing newline and inner spaces', () => {
    expect(formatJsonForPreview('{ "a" : [ 1 , 2 ] , "b" : { } }\n', 'json')).toBe(
      ['{', '  "a": [', '    1,', '    2', '  ],', '  "b": {}', '}'].join('\n'),
    );
  });

  it('returns invalid JSON unchanged', () => {
    const input = '{"a":1,}';

    expect(formatJsonForPreview(input, 'json')).toBe(input);
  });

  it('keeps multi-line JSON in the author layout', () => {
    const input = '{\n    "a": [1, 2, 3]\n}\n';

    expect(formatJsonForPreview(input, 'json')).toBe(input);
  });

  it('leaves other languages and scalar documents alone', () => {
    expect(formatJsonForPreview('{"a":1}', 'javascript')).toBe('{"a":1}');
    expect(formatJsonForPreview('"plain"', 'json')).toBe('"plain"');
    expect(formatJsonForPreview('', 'json')).toBe('');
  });

  it('keeps documents too large or too deeply nested to format raw', () => {
    const large = JSON.stringify(Array.from({ length: 200_000 }, () => 1));
    const deep = '['.repeat(100) + ']'.repeat(100);

    expect(formatJsonForPreview(large, 'json')).toBe(large);
    expect(formatJsonForPreview(deep, 'json')).toBe(deep);
  });

  it('keeps documents that would format into too many lines raw', () => {
    const manyValues = JSON.stringify(Array.from({ length: 20_000 }, () => 0));

    expect(manyValues.length).toBeLessThan(256 * 1024);
    expect(formatJsonForPreview(manyValues, 'json')).toBe(manyValues);
  });

  it('keeps CR-only and CRLF multi-line JSON in the author layout', () => {
    const crOnly = '{\r  "a": 1\r}';
    const crlf = '{\r\n  "a": 1\r\n}';

    expect(formatJsonForPreview(crOnly, 'json')).toBe(crOnly);
    expect(formatJsonForPreview(crlf, 'json')).toBe(crlf);
  });
});
