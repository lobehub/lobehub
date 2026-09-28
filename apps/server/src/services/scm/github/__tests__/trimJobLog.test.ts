import { describe, expect, it } from 'vitest';

import { trimJobLog } from '../app';

const stamp = (line: string, index: number) =>
  `2026-09-20T07:00:${String(index % 60).padStart(2, '0')}.0000000Z ${line}`;

describe('trimJobLog', () => {
  it('centres the window on the first ##[error] and strips timestamps', () => {
    const noise = Array.from({ length: 200 }, (_, i) =>
      stamp(`[command]/usr/bin/git step ${i}`, i),
    );
    const failing = [
      stamp('##[group]Run bash ci.sh', 200),
      stamp('STATUS=fail', 201),
      stamp('##[error]tests failed on purpose (STATUS=fail)', 202),
      stamp('##[error]Process completed with exit code 1.', 203),
      ...Array.from({ length: 50 }, (_, i) => stamp(`Post job cleanup ${i}`, i)),
    ];
    const trimmed = trimJobLog([...noise, ...failing].join('\n'));

    expect(trimmed).toContain('STATUS=fail');
    expect(trimmed).toContain('##[error]tests failed on purpose');
    expect(trimmed).not.toMatch(/2026-09-20T/);
    expect(trimmed).not.toContain('git step 100');
    expect(trimmed).toContain('git step 199');
    expect(trimmed).not.toContain('Post job cleanup 30');
  });

  it('falls back to the tail when there is no annotation', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const trimmed = trimJobLog(lines.join('\n'), 40);
    expect(trimmed.length).toBeLessThanOrEqual(40);
    expect(trimmed.endsWith('line 29')).toBe(true);
    expect(trimmed).not.toContain('line 0\n');
  });
});
