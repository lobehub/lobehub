import { execFile } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const rootDependencies = ['@lobehub/ui', '@lobehub/editor', 'oxlint', 'tsrs', 'vitest'];

async function optionalFile(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function inspectEnvironment(root, { run = exec } = {}) {
  const issues = [];
  const workspaces = [];
  const tools = [];
  const require = createRequire(path.join(root, 'package.json'));
  let semver;
  let parseYaml;
  try {
    semver = require('semver');
    parseYaml = require('yaml').parse;
  } catch {
    return {
      state: 'BLOCKED',
      issues: [
        'Install the declared root dependencies before running doctor (semver/yaml unavailable).',
      ],
    };
  }
  for (const relative of ['.', 'apps/cli']) {
    const cwd = path.resolve(root, relative);
    const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
    const config =
      parseYaml((await optionalFile(path.join(cwd, 'pnpm-workspace.yaml'))) ?? '') ?? {};
    const hasLock = (await optionalFile(path.join(cwd, 'pnpm-lock.yaml'))) !== null;
    const lockfile = config.lockfile === false ? 'disabled' : hasLock ? 'present' : 'missing';
    if (lockfile === 'missing')
      issues.push(
        `${relative}: lockfile enabled but missing; resolve installation policy before building`,
      );
    if (manifest.engines?.node && !semver.satisfies(process.version, manifest.engines.node))
      issues.push(`${relative}: Node ${process.version} does not satisfy ${manifest.engines.node}`);
    const dependencies = [];
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    const entries = Object.entries(declared).filter(
      ([name]) => relative !== '.' || rootDependencies.includes(name),
    );
    for (const [name, declaredRange] of entries) {
      let range = config.overrides?.[name] ?? declaredRange;
      if (range.startsWith('catalog:')) {
        const catalog = range.slice('catalog:'.length);
        range = (catalog ? config.catalogs?.[catalog]?.[name] : config.catalog?.[name]) ?? '';
      }
      let expectedName = name;
      if (range.startsWith('npm:')) {
        const separator = range.lastIndexOf('@');
        expectedName = range.slice(4, separator);
        range = range.slice(separator + 1);
      }
      let installed;
      try {
        installed = JSON.parse(
          await readFile(path.join(cwd, 'node_modules', name, 'package.json'), 'utf8'),
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const workspace = range.startsWith('workspace:');
      const compatible =
        installed?.name === expectedName &&
        (workspace || (semver.validRange(range) && semver.satisfies(installed.version, range)));
      dependencies.push({
        name,
        declared: declaredRange,
        effective: range,
        installed: installed?.version ?? null,
        compatible: !!compatible,
      });
      if (!compatible)
        issues.push(
          `${relative}: ${name} expected ${range}, found ${installed?.version ?? 'missing'}`,
        );
    }
    for (const command of relative === '.' ? ['oxlint', 'tsrs'] : ['vitest', 'tsdown']) {
      try {
        await access(path.join(cwd, 'node_modules/.bin', command));
      } catch {
        issues.push(`${relative}: missing local executable ${command}`);
      }
    }
    workspaces.push({
      directory: relative,
      packageManager: manifest.packageManager ?? null,
      lockfile,
      dependencies,
    });
    for (const command of relative === '.' ? ['bun', 'pnpm', 'npm'] : ['pnpm']) {
      try {
        const { stdout } = await run(command, ['--version'], {
          cwd,
          timeout: 15000,
          env: {
            ...process.env,
            COREPACK_ENABLE_NETWORK: '0',
            COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
          },
        });
        tools.push({ directory: relative, command, version: stdout.trim() });
      } catch {
        issues.push(`${relative}: ${command} --version unavailable (doctor never downloads tools)`);
      }
    }
  }
  return {
    state: issues.length ? 'BLOCKED' : 'PASS',
    checkedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    temporaryDirectory: await realpath(os.tmpdir()),
    workspaces,
    tools,
    issues,
    notes: [
      'Read-only preflight of CLI declarations, root report dependencies and release tools; not a quality gate or complete dependency closure audit.',
      'Use a realpath TMPDIR for tests. Schedule types and heavy tests sequentially to avoid resource-induced timeouts.',
      'A disabled lockfile is intentional: record resolved dependency versions after any approved install. Do not claim a frozen install.',
      'Generated Next route types are checked by the repository type gate. Use an approved clean environment if stale; do not write ad-hoc internal-API repair scripts.',
    ],
  };
}
