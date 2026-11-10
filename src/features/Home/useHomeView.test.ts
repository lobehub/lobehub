import { describe, expect, it } from 'vitest';

import { resolveHomeView } from './useHomeView';

describe('resolveHomeView', () => {
  it('opens the team view from the URL in a workspace', () => {
    expect(resolveHomeView(new URLSearchParams('view=team'), true)).toBe('team');
  });

  it('stays on mine in personal mode, even with the param', () => {
    expect(resolveHomeView(new URLSearchParams('view=team'), false)).toBe('mine');
  });

  it('reads a missing or unknown param as mine', () => {
    expect(resolveHomeView(new URLSearchParams(''), true)).toBe('mine');
    expect(resolveHomeView(new URLSearchParams('view=other'), true)).toBe('mine');
  });
});
