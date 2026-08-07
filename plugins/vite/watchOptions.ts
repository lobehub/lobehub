import type { WatchOptions } from 'vite';

const IGNORED_DIRECTORY_NAMES = new Set([
  '.agent-tracing',
  '.agents',
  '.changeset',
  '.claude',
  '.codex',
  '.cursor',
  '.devcontainer',
  '.github',
  '.husky',
  '.local-config',
  '.next',
  '.nyc_output',
  '.records',
  '.turbo',
  '.vscode',
  '__snapshots__',
  '__tests__',
  'changelog',
  'coverage',
  'devtools',
  'e2e',
  'fixtures',
  'patches',
  'scripts',
  'test',
  'tests',
]);

/** Root-only repository areas; matching these names at arbitrary depth can hide browser routes. */
const IGNORED_ROOT_DIRECTORY_PATHS = [
  ['apps', 'cli'],
  ['apps', 'desktop'],
  ['doc'],
  ['docs'],
  ['packages', 'database'],
  ['src', 'app'],
  ['src', 'server'],
];

const TEST_FILE_PATTERN = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

const normalizeWatchedPath = (filePath: string) =>
  filePath.replaceAll('\\', '/').replace(/\/+$/, '');

const relativeToRoot = (filePath: string, root: string) => {
  if (filePath === root) return '';

  const rootPrefix = `${root}/`;
  if (filePath.startsWith(rootPrefix)) return filePath.slice(rootPrefix.length);
};

const isViteWatchRelativePathIgnored = (relativePath: string) => {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.at(-1) ?? '';

  if (fileName === '.env' || fileName.startsWith('.env.') || TEST_FILE_PATTERN.test(fileName)) {
    return true;
  }

  if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) return true;

  return IGNORED_ROOT_DIRECTORY_PATHS.some((directoryPath) =>
    directoryPath.every((segment, index) => segments[index] === segment),
  );
};

/**
 * Keep the SPA watcher focused on browser runtime sources. Vite otherwise watches the entire
 * monorepo recursively, including independent applications and repository-only tooling.
 */
export const createViteWatchOptions = (sourceRoots: string[]) => {
  const normalizedRoots = sourceRoots.map(normalizeWatchedPath);

  return {
    ignored: (filePath: string) => {
      const normalizedPath = normalizeWatchedPath(filePath);

      return normalizedRoots.some((root) => {
        const relativePath = relativeToRoot(normalizedPath, root);

        return relativePath === undefined ? false : isViteWatchRelativePathIgnored(relativePath);
      });
    },
  } satisfies WatchOptions;
};
