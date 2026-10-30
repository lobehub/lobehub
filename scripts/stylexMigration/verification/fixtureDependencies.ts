import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parse, stringify } from 'yaml';
import { z } from 'zod';

import { dependencyInputFingerprint } from './dependencySnapshot';
import { getStyleFixture } from './fixtureRegistry';
import { sha256, writeJson } from './report';

// Reviewed direct imports of the shared host and its compiler closure. This
// is an advisory capsule, NOT a proof of the production workspace peer graph.
const hostRoots = [
  '@lobehub/ui',
  '@rolldown/plugin-transform-imports',
  '@stylexjs/stylex',
  '@stylexjs/unplugin',
  '@vitejs/plugin-react',
  'motion',
  'react',
  'react-dom',
  'vite',
] as const;

const manifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  overrides: z.record(z.string(), z.string()).optional(),
  packageManager: z.string(),
  pnpm: z.unknown().optional(),
});

/** Never edits source manifests; installation lives inside the owned export. */
export const prepareFixtureDependencies = async (
  directory: string,
  inputs: string[],
  fixtureId: string | string[],
) => {
  const fixtureIds = (typeof fixtureId === 'string' ? [fixtureId] : [...fixtureId]).sort();
  if (!fixtureIds.length || new Set(fixtureIds).size !== fixtureIds.length)
    throw new Error('INVALID_FIXTURE_SELECTION');
  const fixtures = fixtureIds.map(getStyleFixture);
  const root = await realpath(directory);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
  );
  // Do not silently drop executable package-manager configuration.
  if (manifest.pnpm !== undefined) throw new Error('FIXTURE_ROOT_PNPM_CONFIG_REQUIRES_REVIEW');
  const available = { ...manifest.devDependencies, ...manifest.dependencies };
  const dependencies: Record<string, string> = {};
  const roots = [
    ...new Set([...hostRoots, ...fixtures.flatMap((fixture) => fixture.dependencyRoots)]),
  ].sort();
  for (const name of roots) {
    const specifier = available[name];
    if (!specifier || specifier.startsWith('workspace:'))
      throw new Error(`FIXTURE_DEPENDENCY_DECLARATION_MISSING:${name}`);
    dependencies[name] = specifier;
  }
  const workspace = z
    .record(z.string(), z.unknown())
    .parse(parse(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')));
  const capsule = path.join(root, '.stylex-dependencies');
  await mkdir(capsule);
  const capsuleInputs = ['package.json', 'pnpm-workspace.yaml'];
  await writeFile(
    path.join(capsule, 'package.json'),
    JSON.stringify({
      dependencies,
      name: 'stylex-fixture-dependency-capsule',
      overrides: manifest.overrides,
      packageManager: manifest.packageManager,
      private: true,
    }),
    { flag: 'wx' },
  );
  await writeFile(
    path.join(capsule, 'pnpm-workspace.yaml'),
    stringify({
      ...workspace,
      // Preserve dependency resolution/overrides/patch semantics, but not the
      // unrelated workspace importers. Missing workspace imports fail closed.
      allowUnusedPatches: true,
      packages: ['.'],
    }),
    { flag: 'wx' },
  );
  for (const input of inputs.filter((file) => path.basename(file) === '.npmrc')) {
    const config = await readFile(path.join(root, input), 'utf8');
    if (config.split('\n').some((line) => line.trim() && !/^[#;]/.test(line.trim())))
      throw new Error('DEPENDENCY_NPMRC_REQUIRES_REVIEW');
  }
  const patches = z.record(z.string(), z.string()).parse(workspace.patchedDependencies ?? {});
  for (const patch of new Set(Object.values(patches))) {
    if (path.isAbsolute(patch) || patch.includes('\\') || patch.split('/').includes('..'))
      throw new Error('DEPENDENCY_PATCH_ESCAPE');
    const source = await realpath(path.join(root, patch));
    if (!source.startsWith(root + path.sep)) throw new Error('DEPENDENCY_PATCH_ESCAPE');
    const target = path.join(capsule, patch);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source), { flag: 'wx' });
    capsuleInputs.push(patch);
  }
  const evidence = {
    fixtureId: fixtureIds.length === 1 ? fixtureIds[0] : undefined,
    fixtureIds,
    gateEligible: false,
    policy: 'reviewed-fixture-roots-v2',
    reasonCodes: ['FIXTURE_CAPSULE_WORKSPACE_PEER_CONTEXT_UNPROVEN'],
    roots: dependencies,
    sourceDependencyInputHash: await dependencyInputFingerprint(root, inputs),
    schemaVersion: 1,
  };
  await writeJson(capsule, 'capsule.json', evidence);
  return {
    directory: capsule,
    evidence,
    hash: sha256(JSON.stringify(evidence)),
    inputs: [...capsuleInputs, 'capsule.json'],
  };
};

export const mountFixtureDependencies = async (directory: string) => {
  const root = await realpath(directory);
  const modules = await realpath(path.join(root, '.stylex-dependencies/node_modules'));
  if (!modules.startsWith(root + path.sep)) throw new Error('FIXTURE_DEPENDENCY_MOUNT_ESCAPE');
  await symlink('.stylex-dependencies/node_modules', path.join(root, 'node_modules'));
  await mkdir(path.join(root, '.stylex-tools'));
};
