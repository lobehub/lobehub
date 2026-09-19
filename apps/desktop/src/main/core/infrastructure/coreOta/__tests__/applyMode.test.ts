import { describe, expect, it } from 'vitest';

import { computeApplyMode } from '../applyMode';

const file = (p: string, sha: string) => ({ path: p, sha256: sha.repeat(64), size: 1 });

describe('computeApplyMode', () => {
  const base = [
    file('dist/main/index.js', 'a'),
    file('dist/preload/index.js', 'b'),
    file('dist/renderer/assets/x.js', 'c'),
    file('package.json', 'd'),
  ];

  it('is reload when only renderer files change, are added or removed', () => {
    expect(
      computeApplyMode(base, [
        ...base.slice(0, 2),
        file('dist/renderer/assets/x.js', 'e'),
        base[3],
      ]),
    ).toBe('reload');
    expect(computeApplyMode(base, [...base, file('dist/renderer/assets/y.js', 'f')])).toBe(
      'reload',
    );
    expect(
      computeApplyMode(
        base,
        base.filter((f) => !f.path.startsWith('dist/renderer/')),
      ),
    ).toBe('reload');
  });

  it('is relaunch for main, preload or package.json changes', () => {
    expect(computeApplyMode(base, [file('dist/main/index.js', 'z'), ...base.slice(1)])).toBe(
      'relaunch',
    );
    expect(
      computeApplyMode(base, [base[0], file('dist/preload/index.js', 'z'), ...base.slice(2)]),
    ).toBe('relaunch');
    expect(computeApplyMode(base, [...base.slice(0, 3), file('package.json', 'z')])).toBe(
      'relaunch',
    );
  });

  it('is reload for identical trees', () => {
    expect(computeApplyMode(base, [...base].reverse())).toBe('reload');
  });
});
