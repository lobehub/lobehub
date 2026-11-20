import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import ts from 'typescript';

interface AliasEntry {
  exact: boolean;
  prefix: string;
  targets: string[];
}

const tsconfigCache = new Map<string, AliasEntry[]>();

const tsconfigAliases = (root: string): AliasEntry[] => {
  const cached = tsconfigCache.get(root);
  if (cached) return cached;
  const entries: AliasEntry[] = [];
  const file = path.join(root, 'tsconfig.json');
  const { config } = existsSync(file) ? ts.readConfigFile(file, ts.sys.readFile) : { config: {} };
  const options = (config?.compilerOptions ?? {}) as {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  const base = options.baseUrl ?? '.';
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
    const wildcard = pattern.endsWith('*');
    if (pattern.indexOf('*') !== pattern.length - 1 && pattern.includes('*')) continue;
    entries.push({
      exact: !wildcard,
      prefix: wildcard ? pattern.slice(0, -1) : pattern,
      targets: targets
        .filter((target) => !wildcard || target.endsWith('*'))
        .map((target) => path.normalize(path.join(base, wildcard ? target.slice(0, -1) : target))),
    });
  }
  tsconfigCache.set(root, entries);
  return entries;
};

const withTrailingSlash = (prefix: string, target: string) =>
  prefix.endsWith('/') && !target.endsWith('/') ? `${target}/` : target;

export const aliasCandidates = (
  root: string,
  specifier: string,
  aliases: Record<string, string>,
) => {
  const entries: AliasEntry[] = [
    ...Object.entries(aliases).map(([prefix, target]) => ({
      exact: false,
      prefix,
      targets: [target],
    })),
    ...tsconfigAliases(root),
  ];
  const matches = entries
    .filter((entry) =>
      entry.exact ? specifier === entry.prefix : specifier.startsWith(entry.prefix),
    )
    .sort((left, right) => right.prefix.length - left.prefix.length);
  const [best] = matches;
  if (!best) return [];
  return matches
    .filter((entry) => entry.prefix.length === best.prefix.length)
    .flatMap((entry) =>
      entry.targets.map((target) =>
        entry.exact
          ? target
          : withTrailingSlash(entry.prefix, target) + specifier.slice(entry.prefix.length),
      ),
    );
};

const isFile = (file: string) => existsSync(file) && statSync(file).isFile();

export const packageFile = (root: string, from: string, specifier: string) => {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) return undefined;
  try {
    const resolved = createRequire(path.join(root, from)).resolve(specifier);
    if (isFile(resolved)) return resolved;
  } catch {
    /* falls through to the node_modules walk: exports maps can hide plain assets */
  }
  for (let dir = path.dirname(path.join(root, from)); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', specifier);
    if (isFile(candidate)) return candidate;
    if (dir === path.dirname(dir)) return undefined;
  }
};
