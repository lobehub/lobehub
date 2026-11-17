import { describe, expect, it } from 'vitest';

import { sanitizeToolCallArguments } from './sanitizeToolCallArguments';

describe('sanitizeToolCallArguments', () => {
  it('returns valid JSON unchanged', () => {
    const args = '{"title":"Report"}';

    expect(sanitizeToolCallArguments(args)).toBe(args);
  });

  it('keeps a value the model wrote with literal newlines instead of dropping it', () => {
    const content = '<!doctype html>\n<html>\n\t<body>Report</body>\n</html>';

    const sanitized = sanitizeToolCallArguments(
      `{"title":"Report","files":[{"path":"index.html","content":"${content}"}]}`,
    );

    expect(JSON.parse(sanitized)).toEqual({
      files: [{ content, path: 'index.html' }],
      title: 'Report',
    });
  });

  it('recovers the fields of a truncated call', () => {
    expect(JSON.parse(sanitizeToolCallArguments('{"title":"Report","content":"cut'))).toEqual({
      content: 'cut',
      title: 'Report',
    });
  });

  it.each([undefined, '', '{, "a": 1}'])('falls back to "{}" for %j', (args) => {
    expect(sanitizeToolCallArguments(args)).toBe('{}');
  });
});
