import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { validRange } from 'semver';
import { parse, parseAllDocuments } from 'yaml';
import { z } from 'zod';

import { sha256, writeJson } from './report';

const execute = promisify(execFile);
const record = z.record(z.string(), z.unknown());
const manifestSchema = z.object({ packageManager: z.string().optional() });
const supportedPnpmVersion = '12.4.1';

export interface DependencyOptions {
  allowNetwork: boolean;
  pnpm: string;
  store: string;
}

/** No inherited tokens, .env, Node loaders, npm config, SSH agent or Git overrides. */
export const childEnvironment = (directory: string): NodeJS.ProcessEnv => ({
  CI: 'true',
  COREPACK_ENABLE_NETWORK: '0',
  COREPACK_HOME:
    process.env.COREPACK_HOME ??
    path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'), 'node/corepack'),
  LANG: 'en_US.UTF-8',
  NODE_ENV: 'production',
  PATH: process.env.PATH,
  PNPM_HOME: path.join(directory, '.stylex-tools/pnpm'),
  TMPDIR: path.join(directory, '.stylex-tools/tmp'),
  XDG_CACHE_HOME: path.join(directory, '.stylex-tools/cache'),
  XDG_CONFIG_HOME: path.join(directory, '.stylex-tools/config'),
  XDG_DATA_HOME: path.join(directory, '.stylex-tools/data'),
  XDG_STATE_HOME: path.join(directory, '.stylex-tools/state'),
});

export const digestFile = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

/** Canonical content/links/modes, not mtimes or package-manager bookkeeping. */
export const fingerprintInstalledDependencies = async (directory: string) => {
  const root = await realpath(directory);
  const hash = createHash('sha256');
  const rawHash = createHash('sha256');
  const normalizations: Array<{ kind: string; path: string; sha256: string }> = [];
  let bytes = 0;
  let files = 0;
  const visit = async (current: string) => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (entry.isDirectory()) await visit(file);
      else if (entry.isSymbolicLink()) {
        const target = await realpath(file);
        if (!target.startsWith(root + path.sep))
          throw new Error(`DEPENDENCY_LINK_ESCAPE:${relative}`);
        const evidence = JSON.stringify([relative, 'link', await readlink(file)]);
        hash.update(evidence);
        rawHash.update(evidence);
        files++;
      } else if (entry.isFile()) {
        const stat = await lstat(file);
        bytes += stat.size;
        files++;
        if (files > 1_000_000 || bytes > 16 * 1024 ** 3)
          throw new Error('DEPENDENCY_CONTENT_BUDGET_EXCEEDED');
        const digest = await digestFile(file);
        rawHash.update(JSON.stringify([relative, stat.mode & 0o111, stat.size, digest]));
        if (
          current === path.join(root, 'node_modules') &&
          ['.modules.yaml', '.pnpm-workspace-state-v1.json'].includes(entry.name)
        ) {
          normalizations.push({
            kind: 'pnpm-install-location-metadata',
            path: relative,
            sha256: digest,
          });
          continue;
        }
        let portableDigest = digest;
        let portableSize = stat.size;
        if (relative.includes('node_modules/.bin/') && stat.size < 1024 ** 2) {
          const launcher = await readFile(file, 'utf8');
          const target = launcher.match(/\n# cmd-shim-target=(.+)\n*$/)?.[1];
          if (launcher.startsWith('#!/bin/sh\n# Resolve $0 through symlinks') && target) {
            const resolvedTarget = await realpath(target);
            if (!resolvedTarget.startsWith(root + path.sep))
              throw new Error('DEPENDENCY_LAUNCHER_ESCAPE');
            let portable = launcher;
            for (const prefix of new Set([root, directory]))
              portable = portable.replaceAll(prefix + path.sep, '<snapshot>/');
            portableDigest = sha256(portable);
            portableSize = Buffer.byteLength(portable);
            normalizations.push({
              kind: 'pnpm-generated-launcher-location',
              path: relative,
              sha256: digest,
            });
          }
        }
        hash.update(JSON.stringify([relative, stat.mode & 0o111, portableSize, portableDigest]));
      } else throw new Error('DEPENDENCY_FILE_MODE_UNSUPPORTED');
    }
  };
  await visit(path.join(root, 'node_modules'));
  return {
    bytes,
    files,
    normalizations,
    rawSha256: rawHash.digest('hex'),
    sha256: hash.digest('hex'),
  };
};

export const validateDependencyLock = (text: string) => {
  const documents = parseAllDocuments(text);
  if (!documents.length || documents.some((document) => document.errors.length))
    throw new Error('INVALID_DEPENDENCY_LOCK');
  const values = documents.map((document) => record.parse(document.toJS()));
  const graph = values.find((value) => value.importers !== undefined);
  if (!graph || !graph.lockfileVersion) throw new Error('DEPENDENCY_LOCK_GRAPH_MISSING');
  const importers = record.parse(graph.importers);
  if (!Object.keys(importers).length || !importers['.'])
    throw new Error('DEPENDENCY_IMPORTERS_MISSING');
  const packages = record.parse(graph.packages ?? {});
  for (const [name, value] of Object.entries(packages)) {
    const resolution = z.object({ resolution: record }).parse(value).resolution;
    if (
      typeof resolution.integrity !== 'string' ||
      !/^sha512-[A-Za-z0-9+/]{86}==$/.test(resolution.integrity)
    )
      throw new Error(`DEPENDENCY_INTEGRITY_MISSING:${name}`);
    if (
      resolution.tarball !== undefined &&
      (typeof resolution.tarball !== 'string' ||
        !resolution.tarball.startsWith('https://registry.npmjs.org/'))
    )
      throw new Error(`DEPENDENCY_REGISTRY_UNSUPPORTED:${name}`);
  }
  return {
    importers: Object.keys(importers).sort(),
    packageCount: Object.keys(packages).length,
    sha256: sha256(text),
  };
};

const validateSpecifier = (value: string, context: string) => {
  const range = value.startsWith('workspace:')
    ? value.slice('workspace:'.length)
    : value.startsWith('npm:')
      ? value.match(/^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/)?.[1]
      : value;
  if (
    !range ||
    (!validRange(range) && !(value.startsWith('workspace:') && ['^', '~'].includes(range)))
  )
    throw new Error(`DEPENDENCY_PROTOCOL_UNSUPPORTED:${context}`);
};

const checkInstallConfiguration = async (directory: string, inputs: string[]) => {
  for (const file of inputs) {
    if (path.basename(file) === 'package.json') {
      const manifest = record.parse(JSON.parse(await readFile(path.join(directory, file), 'utf8')));
      if (manifest.pnpm !== undefined)
        throw new Error('DEPENDENCY_ROOT_PNPM_CONFIG_REQUIRES_REVIEW');
      for (const [name, value] of Object.entries(
        z.record(z.string(), z.string()).parse(manifest.overrides ?? {}),
      ))
        validateSpecifier(value, `${file}:overrides:${name}`);
      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        if (manifest[field] === undefined) continue;
        for (const [name, value] of Object.entries(
          z.record(z.string(), z.string()).parse(manifest[field]),
        )) {
          validateSpecifier(value, `${file}:${name}`);
        }
      }
    }
    if (path.basename(file) === '.npmrc') {
      const text = await readFile(path.join(directory, file), 'utf8');
      if (text.split('\n').some((line) => line.trim() && !/^[#;]/.test(line.trim())))
        throw new Error('DEPENDENCY_NPMRC_REQUIRES_REVIEW');
    }
  }
  const config = record.parse(
    parse(await readFile(path.join(directory, 'pnpm-workspace.yaml'), 'utf8')),
  );
  for (const key of [
    'configDependencies',
    'hooks',
    'globalPnpmfile',
    'pnpmfile',
    'registries',
    'pnpr',
    'catalogs',
  ])
    if (config[key] !== undefined) throw new Error(`DEPENDENCY_CONFIG_UNSUPPORTED:${key}`);
  for (const [name, value] of Object.entries(
    z.record(z.string(), z.string()).parse(config.overrides ?? {}),
  ))
    validateSpecifier(value, `overrides:${name}`);
  if (config.packageExtensions !== undefined)
    throw new Error('DEPENDENCY_CONFIG_UNSUPPORTED:packageExtensions');
  for (const value of Object.values(
    z.record(z.string(), z.string()).parse(config.patchedDependencies ?? {}),
  )) {
    if (
      path.isAbsolute(value) ||
      value.includes('\\') ||
      value.split('/').includes('..') ||
      !(await realpath(path.join(directory, value))).startsWith(
        (await realpath(directory)) + path.sep,
      )
    )
      throw new Error('DEPENDENCY_PATCH_ESCAPE');
  }
};

export const dependencyInputFingerprint = async (directory: string, inputs: string[]) => {
  const hash = createHash('sha256');
  for (const file of [...inputs].sort())
    hash
      .update(file)
      .update('\0')
      .update(await readFile(path.join(directory, file)))
      .update('\0');
  return hash.digest('hex');
};

/** Only invoked in an owned exported tree; never in the user's checkout. */
export const restoreDependencies = async (
  directory: string,
  inputs: string[],
  options: DependencyOptions,
  frozenLock?: string,
) => {
  const started = performance.now();
  if ((await readdir(directory)).includes('node_modules'))
    throw new Error('DEPENDENCY_TARGET_NOT_CLEAN');
  await checkInstallConfiguration(directory, inputs);
  const inputHash = await dependencyInputFingerprint(directory, inputs);
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')),
  );
  const declaredVersion = manifest.packageManager?.match(
    /^pnpm@(\d+\.\d+\.\d+)(?:\+sha512\.[\da-f]+)?$/,
  )?.[1];
  if (!declaredVersion) throw new Error('EXACT_PNPM_VERSION_REQUIRED');
  if (declaredVersion !== supportedPnpmVersion) throw new Error('PNPM_ADAPTER_VERSION_UNSUPPORTED');
  const env: NodeJS.ProcessEnv = { ...childEnvironment(directory), NODE_ENV: 'development' };
  await mkdir(path.join(directory, '.stylex-tools'));
  await mkdir(env.TMPDIR!, { recursive: true });
  const { stdout } = await execute(options.pnpm, ['--version'], {
    cwd: directory,
    env,
    timeout: 15_000,
  });
  if (stdout.trim() !== declaredVersion) throw new Error('PNPM_VERSION_MISMATCH');
  const common = [
    '--config.pm-on-fail=ignore',
    '--ignore-scripts',
    '--ignore-pnpmfile',
    '--no-runtime',
    '--node-linker=isolated',
    '--config.enable-global-virtual-store=false',
    '--config.virtual-store-dir=node_modules/.pnpm',
    '--config.modules-dir=node_modules',
    '--config.lockfile-dir=' + directory,
    '--config.package-import-method=copy',
    '--config.verify-store-integrity=true',
    '--config.side-effects-cache=false',
    '--config.enable-pre-post-scripts=false',
    '--config.cache-dir=' + path.join(directory, '.stylex-tools/cache'),
    '--userconfig=/dev/null',
    '--registry=https://registry.npmjs.org',
    '--store-dir=' + options.store,
    '--lockfile=true',
    '--reporter=append-only',
  ];
  const invoke = async (stage: string, args: string[]) => {
    const result = await new Promise<{ code: number; stderr: string; stdout: string }>(
      (resolve, reject) => {
        execFile(
          options.pnpm,
          ['install', ...common, ...args],
          { cwd: directory, env, maxBuffer: 8 * 1024 ** 2, timeout: 300_000 },
          (error, stdout, stderr) => {
            if (!error) resolve({ code: 0, stderr, stdout });
            else if (typeof error.code === 'number') resolve({ code: error.code, stderr, stdout });
            else reject(error);
          },
        );
      },
    );
    await writeFile(
      path.join(directory, `.stylex-tools/${stage}.log`),
      result.stdout + result.stderr,
      { flag: 'wx' },
    );
    if (result.code)
      throw new Error(
        `DEPENDENCY_${stage.toUpperCase()}_FAILED: exit ${result.code}; see .stylex-tools/${stage}.log`,
      );
  };
  if (frozenLock !== undefined) {
    if (inputs.includes('pnpm-lock.yaml')) {
      if ((await readFile(path.join(directory, 'pnpm-lock.yaml'), 'utf8')) !== frozenLock)
        throw new Error('DEPENDENCY_LOCK_CONFLICT');
    } else await writeFile(path.join(directory, 'pnpm-lock.yaml'), frozenLock, { flag: 'wx' });
  } else
    await invoke('resolve', [
      '--lockfile-only',
      '--no-frozen-lockfile',
      ...(options.allowNetwork ? [] : ['--offline']),
    ]);
  const lock = await readFile(path.join(directory, 'pnpm-lock.yaml'), 'utf8');
  const graph = validateDependencyLock(lock);
  // Resolution can use the public registry only in the explicit fetch phase.
  if (options.allowNetwork) await invoke('fetch', ['--frozen-lockfile']);
  await invoke('restore', ['--offline', '--frozen-lockfile', '--frozen-store']);
  if (
    (await dependencyInputFingerprint(directory, inputs)) !== inputHash ||
    sha256(await readFile(path.join(directory, 'pnpm-lock.yaml'))) !== graph.sha256
  )
    throw new Error('DEPENDENCY_INPUT_DRIFT');
  const content = await fingerprintInstalledDependencies(directory);
  const result = {
    content,
    durationMs: performance.now() - started,
    graph,
    instanceHash: sha256(
      JSON.stringify({ content: content.rawSha256, inputHash, lock: graph.sha256 }),
    ),
    inputHash,
    lockHash: graph.sha256,
    node: process.version,
    pnpmVersion: declaredVersion,
    runtimePolicy: 'fixed-controller-node-no-provisioning',
    schemaVersion: 1 as const,
    snapshotHash: sha256(
      JSON.stringify({
        content: content.sha256,
        inputHash,
        lock: graph.sha256,
        node: process.version,
        pnpm: declaredVersion,
      }),
    ),
    status: 'RESTORED' as const,
  };
  await writeJson(directory, '.stylex-tools/dependency-snapshot.json', result);
  return { lock, snapshot: result };
};
