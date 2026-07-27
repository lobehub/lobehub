import { SYSTEM_FILES_BLACKLIST } from '@lobechat/const';
import type { ProjectFileIndexEntry } from '@lobechat/electron-client-ipc';

const EXCLUDED_NAMES = new Set([
  ...SYSTEM_FILES_BLACKLIST,

  // Version-control metadata
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  '_darcs',
  'CVS',

  // Dependency directories and package-manager caches
  'node_modules',
  'bower_components',
  'jspm_packages',
  '.pnpm-store',

  // Framework, build, and test caches
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.output',
  '.nyc_output',
  'coverage',

  // Language and infrastructure caches
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
  '.gradle',
  '.m2',
  '.bundle',
  '.terraform',
  '.serverless',
  '.wrangler',

  // Editor metadata that is not project configuration
  '.idea',
  '.fleet',

  // Generated standalone metadata
  '.eslintcache',
  '.pnp.cjs',
  '.pnp.loader.mjs',
]);

const EXCLUDED_SUFFIXES = [
  '.class',
  '.log',
  '.pyc',
  '.pyo',
  '.swp',
  '.swo',
  '.tmp',
  '.tsbuildinfo',
];

// These names can also be legitimate source directories. Hide them only when
// Git confirms they are generated/ignored, preserving tracked distributables.
const GIT_IGNORED_OUTPUT_NAMES = new Set([
  'bin',
  'build',
  'dist',
  'obj',
  'out',
  'target',
  'tmp',
  'vendor',
]);

export const isExcludedProjectFileEntry = (entry: ProjectFileIndexEntry): boolean => {
  const segments = entry.relativePath.split('/');

  return (
    segments.some(
      (segment) =>
        EXCLUDED_NAMES.has(segment) ||
        EXCLUDED_SUFFIXES.some((suffix) => segment.endsWith(suffix)) ||
        segment.endsWith('~'),
    ) ||
    (entry.gitIgnored === true && segments.some((segment) => GIT_IGNORED_OUTPUT_NAMES.has(segment)))
  );
};
