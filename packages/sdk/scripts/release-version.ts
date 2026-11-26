/**
 * Decide which version the release workflow publishes.
 *
 * Versioning contract (see "Releasing" in the README):
 * - `package.json` `version` is the next stable release. A PR that changes the
 *   SDK's surface bumps it and adds a matching `## [x.y.z] - YYYY-MM-DD`
 *   section to CHANGELOG.md, sorted into `### Breaking` / `### Added` /
 *   `### Changed` / `### Fixed`.
 * - The bump has to match the section: `Breaking` needs a major bump (minor
 *   while still on 0.x), `Added` at least a minor one. That is how a breaking
 *   change is expressed — and it cannot ship as a patch by accident.
 * - A push to canary whose version is already on npm publishes a prerelease
 *   `x.y.z-canary.<UTC timestamp>` of the *next* patch under the `canary`
 *   dist-tag instead, so consumers of `latest` only get changelogged releases.
 *
 * Usage (prints JSON `{ version, tag }`):
 *   bun scripts/release-version.ts --published "$(npm view @lobehub/sdk versions --json)"
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type Bump = 'major' | 'minor' | 'patch';

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/;

export const parseSemVer = (version: string): SemVer => {
  const match = version.match(SEMVER);
  if (!match) throw new Error(`"${version}" is not a semver version`);
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] };
};

export const compareSemVer = (a: string, b: string) => {
  const x = parseSemVer(a);
  const y = parseSemVer(b);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] - y[key];
  }
  if (x.prerelease === y.prerelease) return 0;
  if (!x.prerelease) return 1;
  if (!y.prerelease) return -1;
  return x.prerelease < y.prerelease ? -1 : 1;
};

/** The bump from `from` to `to`, or `undefined` when `to` is not newer. */
export const bumpBetween = (from: string, to: string): Bump | undefined => {
  if (compareSemVer(to, from) <= 0) return;
  const x = parseSemVer(from);
  const y = parseSemVer(to);
  if (y.major !== x.major) return 'major';
  if (y.minor !== x.minor) return 'minor';
  return 'patch';
};

/**
 * The body of `## [version]` in a Keep a Changelog file, or `undefined`. The
 * repo's markdown formatter writes the heading as `## \\[version]`.
 */
export const changelogSection = (changelog: string, version: string): string | undefined => {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^## \\\\?\\[${version.replaceAll('.', '\\.')}\\]`).test(line),
  );
  if (start === -1) return;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
};

/** The smallest bump a changelog section allows. */
export const requiredBump = (section: string, current: string): Bump => {
  if (/^### Breaking/m.test(section)) return parseSemVer(current).major === 0 ? 'minor' : 'major';
  if (/^### Added/m.test(section)) return 'minor';
  return 'patch';
};

const BUMP_ORDER: Bump[] = ['patch', 'minor', 'major'];

export interface ReleaseInput {
  changelog: string;
  now?: Date;
  /** Every version already on npm. */
  published: string[];
  /** `version` from package.json. */
  version: string;
}

export const resolveRelease = ({
  changelog,
  now = new Date(),
  published,
  version,
}: ReleaseInput) => {
  parseSemVer(version);
  const stable = published.filter((entry) => SEMVER.test(entry) && !parseSemVer(entry).prerelease);
  const latest = stable.sort(compareSemVer).at(-1);

  if (!published.includes(version)) {
    const section = changelogSection(changelog, version);
    if (!section?.trim()) {
      throw new Error(
        `CHANGELOG.md has no "## [${version}]" section for the version being released`,
      );
    }
    if (latest) {
      const bump = bumpBetween(latest, version);
      if (!bump) throw new Error(`${version} is not newer than the published ${latest}`);
      const needed = requiredBump(section, latest);
      if (BUMP_ORDER.indexOf(bump) < BUMP_ORDER.indexOf(needed)) {
        throw new Error(
          `${latest} → ${version} is a ${bump} bump, but the changelog section needs at least ${needed}`,
        );
      }
    }
    return { tag: 'latest' as const, version };
  }

  const next = parseSemVer(version);
  const stamp = now.toISOString().replaceAll(/\D/g, '').slice(0, 14);
  return {
    tag: 'canary' as const,
    version: `${next.major}.${next.minor}.${next.patch + 1}-canary.${stamp}`,
  };
};

if (import.meta.main) {
  const PKG_ROOT = path.join(import.meta.dirname, '..');
  const flag = process.argv.indexOf('--published');
  const raw = flag === -1 ? '[]' : process.argv[flag + 1] || '[]';
  const parsed = JSON.parse(raw) as string[] | string;

  const release = resolveRelease({
    changelog: readFileSync(path.join(PKG_ROOT, 'CHANGELOG.md'), 'utf8'),
    published: Array.isArray(parsed) ? parsed : [parsed],
    version: JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version,
  });
  console.log(JSON.stringify(release));
}
