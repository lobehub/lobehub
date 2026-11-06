import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { git, run } from './exec';
import type { ImportingTests, PathAliases } from './importers';
import {
  findImportingTests,
  importerGrepPattern,
  isSourceFile,
  parseJsonc,
  pathAliasesFrom,
} from './importers';
import { getConfig, mountDir, rootDir } from './paths';

const SOURCE_PATHSPECS = ['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'];

const prefix = (dir: string, files: string[]) =>
  dir === '' ? files : files.map((file) => `${dir}/${file}`);

/** Every repo's `tsconfig.json` paths; the host's table also covers mounted repos. */
const loadAliases = async (): Promise<PathAliases[]> => {
  const tables = await Promise.all(
    getConfig().repos.map(async (repo) => {
      const text = await readFile(path.join(mountDir(repo), 'tsconfig.json'), 'utf8').catch(
        () => null,
      );
      return text === null ? null : pathAliasesFrom(repo.dir, parseJsonc(text));
    }),
  );
  return tables.filter((table): table is PathAliases => table !== null);
};

/** Tracked and untracked (not ignored) source files across the host and its mounts. */
const listSourceFiles = async (): Promise<Set<string>> => {
  const perRepo = await Promise.all(
    getConfig().repos.map(async (repo) =>
      prefix(
        repo.dir,
        await git(['ls-files', '--cached', '--others', '--exclude-standard'], mountDir(repo)),
      ),
    ),
  );
  return new Set(perRepo.flat().filter((file) => isSourceFile(file)));
};

/** `git grep` each repo for files mentioning one of the specifier tails. */
const grepImporters = async (tails: string[], includeDotImports: boolean) => {
  const pattern = importerGrepPattern(tails, includeDotImports);
  const perRepo = await Promise.all(
    getConfig().repos.map(async (repo) => {
      const result = await run(
        'git',
        ['grep', '-l', '-I', '--untracked', '-E', '-e', pattern, '--', ...SOURCE_PATHSPECS],
        mountDir(repo),
      );
      // Exit 1 means no match; anything else is a real failure.
      if (result.code > 1) throw new Error(`git grep failed: ${result.stderr.trim()}`);
      return prefix(repo.dir, result.stdout.split('\n').filter(Boolean));
    }),
  );
  return perRepo.flat();
};

/** Tests reaching the changed files through imports, across the host and its mounts. */
export const collectImportingTests = async (files: string[]): Promise<ImportingTests> => {
  const [aliases, sourceFiles] = await Promise.all([loadAliases(), listSourceFiles()]);
  // Each repo's walk repeats most greps and reads of the others; share them.
  const greps = new Map<string, Promise<string[]>>();
  const reads = new Map<string, Promise<string>>();
  const cached = <T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = load();
    cache.set(key, pending);
    return pending;
  };
  return findImportingTests(files, {
    aliases,
    files: sourceFiles,
    grep: (tails, dots) =>
      cached(greps, `${dots}:${[...tails].sort().join('|')}`, () => grepImporters(tails, dots)),
    read: (file) => cached(reads, file, () => readFile(path.join(rootDir(), file), 'utf8')),
  });
};
