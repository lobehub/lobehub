import { describe, expect, it } from 'vitest';

import { parseJudgeResponse } from './judge';

describe('parseJudgeResponse', () => {
  it('parses a clean JSON object', () => {
    expect(parseJudgeResponse('{"score":0.8,"reason":"good"}')).toEqual({
      reason: 'good',
      score: 0.8,
    });
  });

  it('recovers the object from a fenced block', () => {
    const raw = 'Here you go:\n```json\n{"score": 0, "reason": "wrong persona"}\n```\n';
    expect(parseJudgeResponse(raw)).toEqual({ reason: 'wrong persona', score: 0 });
  });

  it('keeps a score of 0 rather than treating it as missing', () => {
    expect(parseJudgeResponse('{"score":0,"reason":"fails"}').score).toBe(0);
  });

  it('skips braces inside strings when scanning for the object', () => {
    expect(parseJudgeResponse('note {"reason":"used {curly} braces","score":1} end')).toEqual({
      reason: 'used {curly} braces',
      score: 1,
    });
  });

  it('defaults the reason when the judge omits it', () => {
    expect(parseJudgeResponse('{"score":0.5}')).toEqual({ reason: '', score: 0.5 });
  });

  it('throws when there is no usable score', () => {
    expect(() => parseJudgeResponse('I think it was fine')).toThrow(/parseable score/);
    expect(() => parseJudgeResponse('{"score":"high"}')).toThrow(/parseable score/);
  });
});
