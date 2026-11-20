import { describe, expect, it } from 'vitest';

import { failingModules, stubModule } from './stubs';

const written = ['/wt/src/a/__style_equivalence__A.tsx', '/wt/src/b/__style_equivalence__B.tsx'];

describe('failingModules', () => {
  it('finds the synthetic modules a build error names', () => {
    const message = `BUILD_FAILED
[plugin @stylexjs/unplugin] /wt/src/b/__style_equivalence__B.tsx
TypeError: /wt/src/b/__style_equivalence__B.tsx: undefined is not an object`;
    expect(failingModules(message, written)).toEqual(['/wt/src/b/__style_equivalence__B.tsx']);
  });

  it('finds none when the error is outside the synthetic modules', () => {
    expect(failingModules('BUILD_FAILED\n[UNLOADABLE_DEPENDENCY] src/x', written)).toEqual([]);
  });
});

describe('stubModule', () => {
  it('exports no cases and the error the host renders for each of them', () => {
    const code = stubModule('TypeError: undefined is not an object\n    at x');
    expect(code).toContain('export const cases = {};');
    expect(code).toContain(
      'export const error = "SYNTHETIC_BUILD_FAILED: TypeError: undefined is not an object";',
    );
  });
});
