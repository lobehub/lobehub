import { describe, expect, it } from 'vitest';

import {
  acceptanceCheckPath,
  acceptanceHomePath,
  acceptanceListPath,
  acceptanceOverviewPath,
} from './routes';

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

  it('keeps a project section base so opening a record stays inside the project', () => {
    const base = '/team-x/project/prj_1/acceptance';

    expect(acceptanceListPath(base)).toBe(base);
    expect(acceptanceOverviewPath('acc-1', base)).toBe(`${base}/acc-1`);
    expect(acceptanceCheckPath('acc-1', 'chk-1', base)).toBe(`${base}/acc-1/check/chk-1`);
  });
});
