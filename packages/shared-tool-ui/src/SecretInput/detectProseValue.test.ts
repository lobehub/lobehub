import { describe, expect, it } from 'vitest';

import { detectProseValue } from './detectProseValue';

describe('detectProseValue', () => {
  it('flags CJK text as prose', () => {
    expect(
      detectProseValue('绑定到某个第三方服务（OpenAI / GitHub / 其他）去做 API 调用'),
    ).toBe(true);
    expect(detectProseValue('日語のキーです')).toBe(true);
    expect(detectProseValue('한국어 토큰 값')).toBe(true);
  });

  it('flags long multi-word space-separated text as prose', () => {
    expect(detectProseValue('this is clearly a sentence pasted by accident here')).toBe(true);
  });

  it('passes real token shapes without confirmation', () => {
    expect(detectProseValue('sk-yCUC4oGrKNU1BG95jjE2d7ghMtQh6VAE1C6t5XLtn5ROtvuQ')).toBe(false);
    expect(
      detectProseValue('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc'),
    ).toBe(false);
    expect(detectProseValue('ghp_16C7e42F292c6912E7710c838347Ae178B4a')).toBe(false);
    expect(detectProseValue('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(false);
    expect(detectProseValue('Bearer abc123')).toBe(false);
  });

  it('does not flag short values or empty strings', () => {
    expect(detectProseValue('')).toBe(false);
    expect(detectProseValue('short key')).toBe(false);
    expect(detectProseValue('hunter2')).toBe(false);
  });
});
