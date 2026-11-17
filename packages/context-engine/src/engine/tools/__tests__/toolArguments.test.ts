import { describe, expect, it } from 'vitest';

import {
  describeUnparseableToolArguments,
  escapeJsonStringControlChars,
  parseToolArgumentsLossless,
} from '../toolArguments';

// A createCanvas call whose HTML was written with literal newlines and a tab, as some models
// emit long string values. JSON.parse rejects it ("Bad control character in string literal").
const HTML = '<!doctype html>\n<html>\n\t<body><lobe-alert>Hi</lobe-alert></body>\n</html>';
const RAW_NEWLINE_ARGS = `{"title":"Report","files":[{"path":"index.html","content":"${HTML}"}]}`;

describe('escapeJsonStringControlChars', () => {
  it('escapes raw control characters inside string values', () => {
    expect(escapeJsonStringControlChars('{"a":"x\ny\tz\r\u0001"}')).toBe(
      String.raw`{"a":"x\ny\tz\r\u0001"}`,
    );
  });

  it('leaves whitespace between tokens alone', () => {
    const pretty = '{\n\t"a": "b",\n\t"c": [1, 2]\n}';

    expect(escapeJsonStringControlChars(pretty)).toBe(pretty);
  });

  it('does not treat an escaped quote as the end of the string', () => {
    expect(escapeJsonStringControlChars('{"a":"say \\"hi\\"\nbye"}')).toBe(
      String.raw`{"a":"say \"hi\"\nbye"}`,
    );
  });

  it('keeps an escaped backslash before the closing quote', () => {
    expect(escapeJsonStringControlChars('{"a":"C:\\\\","b":"x\ny"}')).toBe(
      String.raw`{"a":"C:\\","b":"x\ny"}`,
    );
  });

  it('returns the same string when nothing needs escaping', () => {
    const valid = '{"a":"b"}';

    expect(escapeJsonStringControlChars(valid)).toBe(valid);
  });
});

describe('parseToolArgumentsLossless', () => {
  it('parses valid JSON', () => {
    expect(parseToolArgumentsLossless('{"a":1}')).toEqual({ a: 1 });
  });

  it('keeps a string value written with raw newlines and tabs', () => {
    expect(parseToolArgumentsLossless(RAW_NEWLINE_ARGS)).toEqual({
      files: [{ content: HTML, path: 'index.html' }],
      title: 'Report',
    });
  });

  it.each([
    ['an invalid escape', String.raw`{"files":[{"path":"index.html","content":"it\'s"}]}`],
    ['an unquoted key', '{title: "Report"}'],
    ['a truncated stream', '{"title":"Report","content":"cut'],
  ])('returns undefined for %s instead of guessing', (_, text) => {
    expect(parseToolArgumentsLossless(text)).toBeUndefined();
  });

  it.each([undefined, '', '   '])('returns undefined for empty input %j', (text) => {
    expect(parseToolArgumentsLossless(text)).toBeUndefined();
  });
});

describe('describeUnparseableToolArguments', () => {
  it('reports complete but malformed JSON and echoes the raw string', () => {
    const invalid = '{title: "Report"}';

    const result = describeUnparseableToolArguments(invalid);

    expect(result.code).toBe('INVALID_JSON_ARGUMENTS');
    expect(result.message).toMatch(/not valid JSON/);
    expect(result.content).toContain(result.message);
    expect(result.content).toContain(invalid);
  });

  it('reports truncation without naming a specific limit', () => {
    const truncated = '{"title": "Report", "content": "this is cut';

    const result = describeUnparseableToolArguments(truncated);

    expect(result.code).toBe('TRUNCATED_ARGUMENTS');
    expect(result.message).toMatch(/unterminated string/);
    expect(result.message).not.toMatch(/max_tokens/);
    expect(result.content).toContain(truncated);
  });
});
