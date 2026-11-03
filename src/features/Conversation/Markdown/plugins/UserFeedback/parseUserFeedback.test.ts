import { describe, expect, it } from 'vitest';

import { parseUserFeedback } from './parseUserFeedback';

describe('parseUserFeedback', () => {
  it('parses comments with id and time', () => {
    const raw = `<comment id="cmt_1" time="9d ago">你能否写成文档而不是写在最后一个输出里？</comment>
<comment id="cmt_2" time="9d ago">不是写到linear 里，而是写 agent Document 里面</comment>`;

    const parsed = parseUserFeedback(raw);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      content: '你能否写成文档而不是写在最后一个输出里？',
      id: 'cmt_1',
      time: '9d ago',
    });
    expect(parsed[1].content).toBe('不是写到linear 里，而是写 agent Document 里面');
  });

  it('handles comments without attributes', () => {
    const raw = `<comment>plain feedback</comment>`;
    const parsed = parseUserFeedback(raw);
    expect(parsed).toEqual([{ content: 'plain feedback', id: undefined, time: undefined }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseUserFeedback('')).toEqual([]);
  });

  it('ignores stray text between comments', () => {
    const raw = `noise<comment time="1m ago">a</comment>more noise<comment>b</comment>`;
    const parsed = parseUserFeedback(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe('a');
    expect(parsed[1].content).toBe('b');
  });
});
