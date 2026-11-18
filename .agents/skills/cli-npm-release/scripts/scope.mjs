import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function collectScope(root, baseline) {
  if (!/^[\da-f]{40}$/.test(baseline)) throw new Error('Use the verified full baseline SHA');
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  git('merge-base', '--is-ancestor', baseline, 'HEAD');
  const baselinePaths = new Set(git('ls-tree', '-r', '--name-only', '-z', baseline).split('\0'));
  const paths = new Set([...git('ls-files', '-z').split('\0'), ...baselinePaths]);
  const manifests = [...paths].filter((file) => /^(apps|packages)\/.+\/package\.json$/.test(file));
  const packages = new Map();
  for (const file of manifests) {
    const versions = [];
    if (existsSync(path.join(root, file)))
      versions.push(JSON.parse(readFileSync(path.join(root, file), 'utf8')));
    if (baselinePaths.has(file)) versions.push(JSON.parse(git('show', `${baseline}:${file}`)));
    for (const manifest of versions) {
      if (!manifest.name) continue;
      const entries = packages.get(manifest.name) ?? [];
      entries.push({ directory: path.dirname(file), manifest });
      packages.set(manifest.name, entries);
    }
  }
  const directories = new Set(['apps/cli', 'apps/workbench']);
  const queue = [...packages]
    .filter(([, entries]) => entries.some(({ directory }) => directories.has(directory)))
    .map(([name]) => name);
  const visited = new Set();
  while (queue.length) {
    const name = queue.shift();
    if (visited.has(name)) continue;
    visited.add(name);
    for (const { directory, manifest } of packages.get(name) ?? []) {
      directories.add(directory);
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      };
      for (const dependency of Object.keys(dependencies)) {
        if (packages.has(dependency)) queue.push(dependency);
      }
    }
  }
  const scope = [
    ...directories,
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.github/workflows/preview-cli.yml',
    '.github/actions/setup-env',
    'scripts',
  ];
  const changed = git('diff', '--name-only', '-z', `${baseline}..HEAD`, '--', ...scope)
    .split('\0')
    .filter(Boolean);
  return {
    baseline,
    candidate: git('rev-parse', 'HEAD').trim(),
    packages: Object.fromEntries(
      [...visited]
        .sort()
        .map((name) => [name, [...new Set(packages.get(name).map(({ directory }) => directory))]]),
    ),
    paths: scope.sort(),
    changed,
    existingChanged: changed.filter((file) => existsSync(path.join(root, file))),
    dirty: git('status', '--short', '--', ...scope).trim(),
    note: 'Conservative manifest dependency closure across baseline and candidate, not proof of bundled reachability. Review imports, build scripts, deleted files and backend contracts before marking scope PASS.',
  };
}
