import { describe, expect, it } from 'vitest';

import {
  formatRawVariables,
  getRawVariableFormat,
  parseDotenv,
  parseJsonVariables,
  parseRawVariables,
} from './EnvironmentVariables';

describe('parseDotenv', () => {
  it('should read KEY=value lines and skip blanks and comments', () => {
    expect(
      parseDotenv('# comment\n\nNODE_ENV=production\nexport API_URL = https://x.dev\n'),
    ).toEqual({
      entries: [
        ['NODE_ENV', 'production'],
        ['API_URL', 'https://x.dev'],
      ],
    });
  });

  it('should strip a matching pair of quotes and let later lines win', () => {
    expect(parseDotenv('A="with space"\nB=\'x\'\nA=second')).toEqual({
      entries: [
        ['A', 'second'],
        ['B', 'x'],
      ],
    });
  });

  it('should name the first line that is not a pair', () => {
    expect(parseDotenv('OK=1\nnot a pair\nALSO=2')).toEqual({ line: 2 });
    expect(parseDotenv('1BAD=x')).toEqual({ line: 1 });
  });

  it('should round-trip through the JSON editor', () => {
    const entries: [string, string][] = [
      ['PLAIN', 'value'],
      ['SPACED', 'two words'],
      ['HASH', 'a#b'],
    ];
    expect(parseRawVariables(formatRawVariables(entries))).toEqual({ entries });
  });

  it.each([
    'say "hello" C:\\qa',
    '"quoted"',
    'both \'single\' and "double" quotes',
    'line one\nline two\r\nlast',
    'tab\there',
    '  padded  ',
    '\\n is literal',
    'control\u0000character',
  ])('should preserve %j across repeated raw editor saves', (value) => {
    const entries: [string, string][] = [['QA_VALUE', value]];
    const first = parseRawVariables(formatRawVariables(entries));
    expect(first).toEqual({ entries });
    if ('entries' in first) {
      expect(parseRawVariables(formatRawVariables(first.entries))).toEqual({ entries });
    }
  });

  it('should preserve JSON-valid escapes in double-quoted dotenv imports', () => {
    expect(
      parseDotenv(String.raw`A="C:\test\new"
B="\u0041"`),
    ).toEqual({
      entries: [
        ['A', String.raw`C:\test\new`],
        ['B', String.raw`\u0041`],
      ],
    });
  });

  it('should retain literal backslashes in single-quoted and unquoted imports', () => {
    expect(
      parseDotenv(String.raw`A='C:\test\new'
B=C:\test\new
C="C:\qa"`),
    ).toEqual({
      entries: [
        ['A', String.raw`C:\test\new`],
        ['B', String.raw`C:\test\new`],
        ['C', String.raw`C:\qa`],
      ],
    });
  });
});

describe('raw variable formats', () => {
  it('should identify JSON and dotenv without changing dotenv escape semantics', () => {
    expect(getRawVariableFormat('  {"A": "value"}')).toBe('json');
    expect(getRawVariableFormat('A="value"')).toBe('dotenv');
    expect(
      parseRawVariables(String.raw`A="C:\test\new"
B="\u0041"
C="\b\f\r\t"`),
    ).toEqual({
      entries: [
        ['A', String.raw`C:\test\new`],
        ['B', String.raw`\u0041`],
        ['C', String.raw`\b\f\r\t`],
      ],
    });
  });

  it('should decode edited JSON and preserve it after reopening and saving', () => {
    const edited = String.raw`{"PATH":"C:\\test\\new", "TEXT":"say \"hello\"\nnext", "UNICODE":"\u0041"}`;
    const result = parseRawVariables(edited);
    expect(result).toEqual({
      entries: [
        ['PATH', String.raw`C:\test\new`],
        ['TEXT', 'say "hello"\nnext'],
        ['UNICODE', 'A'],
      ],
    });
    if ('entries' in result) {
      expect(parseRawVariables(formatRawVariables(result.entries))).toEqual(result);
    }
  });

  it.each(['null', '[]', '1', 'true', '"text"', '{"A":1}', '{"A":null}', '{"A":[]}', '{"A":{}}'])(
    'should reject non-string JSON objects: %s',
    (text) => {
      expect(parseJsonVariables(text)).toEqual({ error: 'jsonValues' });
    },
  );

  it('should reject incomplete JSON without interpreting it as dotenv', () => {
    expect(parseRawVariables('{"A":"value"')).toEqual({ error: 'jsonSyntax' });
    expect(parseRawVariables('["value"]')).toEqual({ error: 'jsonValues' });
  });

  it('should support empty values, empty objects and duplicate keys', () => {
    expect(parseRawVariables('{"A":"old","A":""}')).toEqual({ entries: [['A', '']] });
    expect(parseRawVariables('{}')).toEqual({ entries: [] });
    expect(parseRawVariables('')).toEqual({ entries: [] });
  });

  it('should preserve property-like variable names without modifying prototypes', () => {
    const entries: [string, string][] = [
      ['__proto__', 'literal'],
      ['constructor', 'value'],
    ];
    expect(parseRawVariables(formatRawVariables(entries))).toEqual({ entries });
  });
});
