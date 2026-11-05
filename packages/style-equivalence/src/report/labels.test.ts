import { describe, expect, it } from 'vitest';

import { flagExplanation, flagLabel } from './labels';

describe('flag labels', () => {
  it('labels a file gap by its kind and keeps the stylesheet it names', () => {
    expect(flagLabel('STYLESHEET_UNREADABLE:pkg/reset.css')).toBe('样式表读不到：pkg/reset.css');
    expect(flagExplanation('STYLESHEET_UNREADABLE:pkg/reset.css')).toContain('读不到');
  });

  it('names a runtime style present on one side only in plain words', () => {
    expect(flagLabel('RUNTIME_STYLE_DROPPED')).toBe('运行时 style 只在一侧');
    expect(flagExplanation('RUNTIME_STYLE_DROPPED')).toContain('style=');
  });

  it('names the components a partly forwarded descendant rule still reaches', () => {
    const flag = 'INNER_TARGET_PARTLY_FORWARDED:h1|AcceptanceGoal,AcceptanceIdentity';
    expect(flagLabel(flag)).toBe('只证明了传进组件的那个 h1');
    expect(flagExplanation(flag)).toContain('AcceptanceGoal、AcceptanceIdentity');
  });

  it('names the callers of a forwarded prop that were not compared', () => {
    const flag = 'FORWARDED_CALLER_UNCHECKED:a.tsx,b.tsx';
    expect(flagLabel(flag)).toBe('有调用方没比较：a.tsx、b.tsx');
    expect(flagExplanation(flag)).toContain('a.tsx、b.tsx');
  });

  it('falls back to the raw flag when it has no label', () => {
    expect(flagLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
