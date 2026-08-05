import { describe, expect, it } from 'vitest';

import { acceptanceCheckPath, acceptanceHomePath, acceptanceOverviewPath } from './routes';

describe('acceptance routes', () => {
  it('returns from the acceptance workspace to home', () => {
    expect(acceptanceHomePath()).toBe('/');
  });

  it('builds the overview route', () => {
    expect(acceptanceOverviewPath('acceptance-1')).toBe('/acceptance/acceptance-1');
  });

  it('builds the nested check route and escapes route params', () => {
    expect(acceptanceCheckPath('acceptance/1', 'check/1')).toBe(
      '/acceptance/acceptance%2F1/check/check%2F1',
    );
  });
});
