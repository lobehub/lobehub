import path from 'node:path';

/** Where `bun run build:file-parse-worker` writes the worker, relative to the app root. */
const FILE_PARSE_WORKER_RELATIVE_PATH = 'dist/file-parse-worker/fileParseWorker.mjs';

/** Deployments whose working directory is not the app root (the channel worker image) set this. */
export const FILE_PARSE_WORKER_PATH_ENV = 'FILE_PARSE_WORKER_PATH';

/**
 * The worker is a prebuilt file, started by absolute path: `new Worker(new URL(...))` would make
 * the bundler emit a virtual asset, and a path derived from the module location changes with how
 * the server is bundled. Next standalone keeps the app root as the working directory and carries
 * the file through `outputFileTracingIncludes`.
 */
export const resolveFileParseWorkerPath = (): string =>
  process.env[FILE_PARSE_WORKER_PATH_ENV] ||
  path.join(/* turbopackIgnore: true */ process.cwd(), FILE_PARSE_WORKER_RELATIVE_PATH);
