/**
 * System files to be filtered out when listing directory contents
 */
export const SYSTEM_FILES_BLACKLIST = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.localized',
  'ehthumbs.db',
  'ehthumbs_vista.db',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.Spotlight-V100',
  '.fseventsd',
  '.Trashes',
];

export const FILE_UPLOAD_BLACKLIST = SYSTEM_FILES_BLACKLIST;

export const MAX_UPLOAD_FILE_COUNT = 10;

export const MAX_UPLOAD_FILE_SIZE = 2 * 1024 * 1024 * 1024 - 1;

export const UPLOAD_FILE_SIZE_LIMIT_ERROR_MESSAGE = `Files larger than ${MAX_UPLOAD_FILE_SIZE} bytes cannot be uploaded`;

export const MAX_FILE_PARSE_SIZE = 64 * 1024 * 1024;

export const FILE_PARSE_SIZE_LIMIT_ERROR_MESSAGE = `Files larger than ${MAX_FILE_PARSE_SIZE} bytes cannot be parsed in memory`;

export const WORKSPACE_FILE_TREE_EXCLUDED_NAMES = [
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
];

export const WORKSPACE_FILE_TREE_EXCLUDED_SUFFIXES = [
  '.class',
  '.log',
  '.pyc',
  '.pyo',
  '.swp',
  '.swo',
  '.tmp',
  '.tsbuildinfo',
  '~',
];

// These names can also be legitimate source directories. Hide them only when
// Git confirms they are generated/ignored, preserving tracked distributables.
export const WORKSPACE_FILE_TREE_GIT_IGNORED_OUTPUT_NAMES = [
  'bin',
  'build',
  'dist',
  'obj',
  'out',
  'target',
  'tmp',
  'vendor',
];

/**
 * DataTransfer MIME type used when dragging a file/folder row from the working
 * sidebar file tree into the chat input. A custom (non-`Files`) type so the
 * file-upload drop zone ignores it — it only reacts to `Files` — and the drop
 * handler turns it into a `<localFile />` mention instead of uploading a blob.
 */
export const WORKSPACE_FILE_DRAG_MIME = 'application/x-lobe-workspace-file';
