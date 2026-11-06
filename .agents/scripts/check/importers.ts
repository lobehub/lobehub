import path from 'node:path';

import { isTestFile } from './routing';

/**
 * Static reverse-import lookup for related tests. A test that reaches a
 * changed file only through other modules (a barrel, a re-export, a host
 * module overriding a mounted one) has no name relation to it, so name-based
 * candidates miss it. `vitest related` finds it but builds the module graph of
 * every test in the config: about 15 seconds at a host root and over a minute
 * in a large repo even when nothing matches. This walks importers backwards
 * from the changed files with `git grep` and a tsconfig `paths` resolver
 * instead, a bounded number of hops. Dynamic specifiers and package-name
 * imports stay out of reach; `--related` remains the exact fallback.
 */

/** A tsconfig `paths` table, with targets relative to the host root. */
export interface PathAliases {
  /** Root-relative directory of the tsconfig; only importers inside it use the table. */
  dir: string;
  paths: Record<string, string[]>;
}

export interface ImporterSearch {
  aliases: PathAliases[];
  /** Root-relative source files that exist, tracked or untracked. */
  files: Set<string>;
  /** Root-relative files whose text may contain one of these specifier tails. */
  grep: (tails: string[], includeDotImports: boolean) => Promise<string[]>;
  read: (file: string) => Promise<string>;
}

export interface ImportingTests {
  tests: string[];
  /** Tests left out after the limit, or files whose importers were not followed. */
  truncated: boolean;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
export const isSourceFile = (file: string) => SOURCE_EXTENSIONS.includes(path.extname(file));

/** Hops from a changed file to a test: source → barrel → re-export → test. */
export const MAX_IMPORT_DEPTH = 3;
/** Above this many importers in one hop the module is widely shared; stop following it. */
export const MAX_FRONTIER = 200;
/** More related tests than this belong to `--related`, not to a quick default run. */
export const MAX_IMPORTING_TESTS = 40;

const SPECIFIER_PATTERN =
  /(?:\bfrom|\bimport|\brequire|\.mock|\.doMock|\.importActual)\s*\(?\s*["']([^\n"']+)["']/g;

/** Module specifiers in import, export, require, dynamic import, and `vi.mock` positions. */
export const extractSpecifiers = (source: string): string[] =>
  [...source.matchAll(SPECIFIER_PATTERN)].map((match) => match[1]);

/** The last specifier segment that can name a file: `a/b/index.ts` is imported as `a/b`. */
export const specifierTail = (file: string) => {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  return base === 'index' ? path.basename(path.dirname(file)) : base;
};

const resolveFile = (candidate: string, files: Set<string>): string | null => {
  const normalized = path.normalize(candidate);
  if (files.has(normalized)) return normalized;
  for (const ext of SOURCE_EXTENSIONS) {
    if (files.has(`${normalized}${ext}`)) return `${normalized}${ext}`;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const index = path.join(normalized, `index${ext}`);
    if (files.has(index)) return index;
  }
  return null;
};

const resolveFirst = (targets: string[], capture: string, files: Set<string>) => {
  for (const target of targets) {
    const resolved = resolveFile(target.replace('*', capture), files);
    if (resolved) return resolved;
  }
  return null;
};

/** Whether a root-relative path is `dir` itself or inside it; `''` is the host root. */
const contains = (dir: string, file: string) =>
  dir === '' || file === dir || file.startsWith(`${dir}/`);

/** TypeScript `paths` lookup: the longest matching prefix wins, then its first existing target. */
const resolveAlias = (specifier: string, table: PathAliases, files: Set<string>) => {
  let best: { capture: string; prefix: string; targets: string[] } | undefined;
  for (const [pattern, targets] of Object.entries(table.paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === specifier) return resolveFirst(targets, '', files);
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (best && best.prefix.length >= prefix.length) continue;
    best = {
      capture: specifier.slice(prefix.length, specifier.length - suffix.length),
      prefix,
      targets,
    };
  }
  return best ? resolveFirst(best.targets, best.capture, files) : null;
};

/**
 * Files a specifier can resolve to from an importer, under every given table
 * that covers the importer.
 */
export const resolveSpecifier = (
  specifier: string,
  importer: string,
  aliases: PathAliases[],
  files: Set<string>,
): string[] => {
  if (specifier.startsWith('.')) {
    const resolved = resolveFile(path.join(path.dirname(importer), specifier), files);
    return resolved ? [resolved] : [];
  }
  const resolved = aliases
    .filter((table) => contains(table.dir, importer))
    .map((table) => resolveAlias(specifier, table, files))
    .filter((file): file is string => file !== null);
  return [...new Set(resolved)];
};

/** The deepest table covering a file: the repo whose config runs it. */
const ownerOf = (file: string, aliases: PathAliases[]) =>
  aliases
    .filter((table) => contains(table.dir, file))
    .sort((a, b) => b.dir.length - a.dir.length)[0];

/**
 * Tests owned by one repo (`owner`) that import the changed files directly or
 * through up to `MAX_IMPORT_DEPTH` hops, nearest first. The repo's tests run
 * under its own config, so modules resolve with its table plus the tables of
 * repos mounted inside it: a mounted module running in a host test sees the
 * host's aliases and same-path overrides. Over-approximating there is cheaper
 * than missing a test.
 */
const findOwnedImportingTests = async (
  changed: string[],
  owner: PathAliases,
  search: ImporterSearch,
): Promise<ImportingTests> => {
  const aliases = search.aliases.filter((table) => contains(owner.dir, table.dir));
  const visited = new Set(changed);
  const tests: string[] = [];
  let truncated = false;
  let frontier = changed.filter(
    (file) => contains(owner.dir, file) && isSourceFile(file) && !isTestFile(file),
  );

  for (let depth = 0; depth < MAX_IMPORT_DEPTH && frontier.length > 0; depth++) {
    const targets = new Set(frontier);
    const candidates = await search.grep(
      [...new Set(frontier.map(specifierTail))],
      frontier.some((file) => /^index\.[^.]+$/.test(path.basename(file))),
    );
    const eligible = candidates.filter(
      (importer) =>
        !visited.has(importer) &&
        contains(owner.dir, importer) &&
        isSourceFile(importer) &&
        (!isTestFile(importer) || ownerOf(importer, search.aliases) === owner),
    );
    const sources = await Promise.all(eligible.map((importer) => search.read(importer)));
    const next: string[] = [];
    for (const [index, importer] of eligible.entries()) {
      const test = isTestFile(importer);
      const imports = extractSpecifiers(sources[index]).some((specifier) =>
        resolveSpecifier(specifier, importer, test ? [owner] : aliases, search.files).some((file) =>
          targets.has(file),
        ),
      );
      if (!imports) continue;
      visited.add(importer);
      if (test) tests.push(importer);
      else next.push(importer);
    }
    if (next.length > MAX_FRONTIER) {
      truncated = true;
      break;
    }
    frontier = next;
  }
  return { tests, truncated };
};

/** Tests in every repo that reach the changed files through imports. */
export const findImportingTests = async (
  changed: string[],
  search: ImporterSearch,
): Promise<ImportingTests> => {
  const results = await Promise.all(
    search.aliases.map((owner) => findOwnedImportingTests(changed, owner, search)),
  );
  const tests = [...new Set(results.flatMap((result) => result.tests))];
  return {
    tests: tests.slice(0, MAX_IMPORTING_TESTS),
    truncated: tests.length > MAX_IMPORTING_TESTS || results.some((result) => result.truncated),
  };
};

/** Escape a literal for a POSIX extended regular expression. */
const escapeEre = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

/**
 * `git grep -E` pattern for specifiers ending in one of the tails. For index
 * files it also matches specifiers made only of `.`/`..` segments, optionally
 * ending in `index` (`'.'`, `'../'`, `'./index'`, `'../../index.ts'`).
 */
export const importerGrepPattern = (tails: string[], includeDotImports: boolean) => {
  const named = `["']([^"']*/)?(${tails.map(escapeEre).join('|')})(/index)?(\\.[cm]?[jt]sx?)?["']`;
  const dots = `["']\\.\\.?(/\\.\\.)*(/(index(\\.[cm]?[jt]sx?)?)?)?["']`;
  return includeDotImports ? `${named}|${dots}` : named;
};

/** Parse a tsconfig: JSON plus comments and trailing commas. */
export const parseJsonc = (text: string): unknown => {
  let output = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      const end = /"(?:[^"\\]|\\.)*"/y;
      end.lastIndex = index;
      const match = end.exec(text);
      if (!match) throw new SyntaxError('unterminated string in tsconfig');
      output += match[0];
      index += match[0].length - 1;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      output += '\n';
    } else if (char === '/' && text[index + 1] === '*') {
      index = text.indexOf('*/', index + 2) + 1;
      if (index === 0) throw new SyntaxError('unterminated comment in tsconfig');
    } else {
      output += char;
    }
  }
  return JSON.parse(output.replaceAll(/,(\s*[\]}])/g, '$1'));
};

/** `compilerOptions.paths` of a tsconfig at `dir`, with targets made root-relative. */
export const pathAliasesFrom = (dir: string, tsconfig: unknown): PathAliases | null => {
  if (typeof tsconfig !== 'object' || tsconfig === null) return null;
  const options = (tsconfig as { compilerOptions?: { baseUrl?: string; paths?: unknown } })
    .compilerOptions;
  if (!options?.paths || typeof options.paths !== 'object') return null;
  const base = path.join(dir, options.baseUrl ?? '.');
  const paths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(options.paths as Record<string, unknown>)) {
    if (!Array.isArray(targets)) continue;
    paths[pattern] = targets.map((target) => path.join(base, String(target)));
  }
  return { dir, paths };
};
