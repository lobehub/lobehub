import { describe, expect, it } from 'vitest';

import { packSkillArchive, unpackSkillArchive } from './archive';

describe('skill archive', () => {
  // Named by its hash in storage: the same package published twice is one object.
  it('zips the same package to the same bytes, whatever order its files come in', () => {
    const a = packSkillArchive('# plan', [
      { data: 'echo ok', path: 'scripts/check.sh' },
      { data: '# rules', path: 'references/review.md' },
    ]);
    const b = packSkillArchive('# plan', [
      { data: '# rules', path: 'references/review.md' },
      { data: 'echo ok', path: 'scripts/check.sh' },
    ]);
    expect(a.hash).toBe(b.hash);
    expect(packSkillArchive('# other plan', []).hash).not.toBe(a.hash);
  });

  it('reads SKILL.md and every file back, a binary one by size', () => {
    const { bytes } = packSkillArchive('# plan', [
      { data: 'echo ok', path: 'scripts/check.sh' },
      { data: new Uint8Array([0xff, 0xfe, 0x00]), path: 'assets/logo.png' },
    ]);

    expect(unpackSkillArchive(bytes)).toEqual({
      content: '# plan',
      files: [
        { binary: true, content: '', path: 'assets/logo.png', size: 3 },
        { content: 'echo ok', path: 'scripts/check.sh', size: 7 },
      ],
    });
  });

  // Package paths come from the caller; one named after an object built-in
  // would set an object's prototype while zipping, so it is refused outright.
  it('refuses a file whose path is an object built-in', () => {
    for (const path of ['__proto__', 'scripts/constructor', 'prototype/x.sh'])
      expect(() => packSkillArchive('# plan', [{ data: 'odd', path }])).toThrow(
        'names an object built-in',
      );
  });
});
