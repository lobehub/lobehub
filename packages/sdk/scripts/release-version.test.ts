import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bumpBetween, changelogSection, resolveRelease } from './release-version';

const changelog = (version: string, ...headings: string[]) =>
  `# Changelog\n\n## [${version}] - 2026-11-17\n\n${headings.map((heading) => `### ${heading}\n\n- entry\n`).join('\n')}\n## [0.9.0] - 2026-01-01\n\n### Fixed\n\n- old\n`;

const now = new Date('2026-11-17T08:09:10Z');

describe('resolveRelease', () => {
  it('publishes a new changelogged version to latest', () => {
    expect(
      resolveRelease({
        changelog: changelog('1.1.0', 'Added'),
        now,
        published: ['1.0.20261030101445'],
        version: '1.1.0',
      }),
    ).toEqual({ tag: 'latest', version: '1.1.0' });
  });

  it('publishes a canary prerelease of the next patch once the version is out', () => {
    expect(
      resolveRelease({
        changelog: changelog('1.1.0', 'Added'),
        now,
        published: ['1.0.20261030101445', '1.1.0'],
        version: '1.1.0',
      }),
    ).toEqual({ tag: 'canary', version: '1.1.1-canary.20261117080910' });
  });

  it('expresses a breaking change as a major bump and refuses a smaller one', () => {
    const published = ['1.1.0'];
    expect(
      resolveRelease({
        changelog: changelog('2.0.0', 'Breaking'),
        now,
        published,
        version: '2.0.0',
      }),
    ).toEqual({ tag: 'latest', version: '2.0.0' });
    expect(() =>
      resolveRelease({
        changelog: changelog('1.2.0', 'Breaking'),
        now,
        published,
        version: '1.2.0',
      }),
    ).toThrow('needs at least major');
  });

  it('refuses to ship an Added entry as a patch', () => {
    expect(() =>
      resolveRelease({
        changelog: changelog('1.1.1', 'Added'),
        now,
        published: ['1.1.0'],
        version: '1.1.1',
      }),
    ).toThrow('needs at least minor');
  });

  it('requires a changelog section for the released version', () => {
    expect(() =>
      resolveRelease({
        changelog: changelog('1.1.0', 'Added'),
        now,
        published: [],
        version: '1.2.0',
      }),
    ).toThrow('no "## [1.2.0]" section');
  });

  it('refuses a version that is not newer than the published one', () => {
    expect(() =>
      resolveRelease({
        changelog: changelog('1.0.5', 'Fixed'),
        now,
        published: ['1.1.0'],
        version: '1.0.5',
      }),
    ).toThrow('not newer');
  });
});

describe('helpers', () => {
  it('reads a section whether or not the formatter escaped its bracket', () => {
    expect(changelogSection('## \\[2.0.0] - 2026-12-01\n\n### Breaking\n', '2.0.0')).toContain(
      'Breaking',
    );
  });

  it('reads one section and the bump between versions', () => {
    expect(changelogSection(changelog('1.1.0', 'Added'), '1.1.0')).toContain('### Added');
    expect(changelogSection(changelog('1.1.0', 'Added'), '1.1.0')).not.toContain('old');
    expect(bumpBetween('1.0.20261030101445', '1.1.0')).toBe('minor');
    expect(bumpBetween('1.1.0', '1.1.0')).toBeUndefined();
  });

  it('accepts the committed package.json version and CHANGELOG.md', () => {
    const root = path.join(import.meta.dirname, '..');
    const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const release = resolveRelease({
      changelog: readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
      // The last timestamp release before semver.
      published: ['1.0.20261030101445'],
      version,
    });
    expect(release.version).toBe(version);
  });
});
