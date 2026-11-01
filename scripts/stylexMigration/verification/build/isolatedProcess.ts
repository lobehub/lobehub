import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { childEnvironment } from '../dependencies/dependencySnapshot';

const execute = promisify(execFile);
const quote = (value: string) => JSON.stringify(value);

export const sandboxProfile = (
  root: string,
  executables: string[],
  writableDirectory = path.join(root, '.stylex-tools'),
) => {
  const toolRoot = path.resolve(root, '.stylex-tools');
  const writable = path.resolve(writableDirectory);
  if (writable !== toolRoot && !writable.startsWith(toolRoot + path.sep))
    throw new Error('BUILD_WRITE_SCOPE_ESCAPE');
  const readable = [
    '/System',
    '/usr',
    '/Library',
    '/private/etc',
    '/private/var/db',
    '/dev',
    '/bin',
    '/sbin',
    root,
  ];
  return `(version 1)
(deny default)
(import "dyld-support.sb")
(allow process*)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read* file-map-executable ${readable.map((file) => `(subpath ${quote(file)})`).join(' ')} ${executables.map((file) => `(literal ${quote(file)})`).join(' ')})
(allow file-write* (subpath ${quote(writable)}) (literal "/dev/null"))
`;
};

/** Local macOS adapter only. No silent unsandboxed build fallback. */
export const runIsolatedProcess = async (
  root: string,
  executable: string,
  args: string[],
  executablePaths: string[],
  writableDirectory = path.join(root, '.stylex-tools'),
) => {
  if (process.platform !== 'darwin') throw new Error('BUILD_SANDBOX_ADAPTER_UNAVAILABLE');
  const canonicalRoot = await realpath(root);
  const executables = await Promise.all(executablePaths.map((file) => realpath(file)));
  const writable = await realpath(writableDirectory);
  return execute(
    '/usr/bin/sandbox-exec',
    ['-p', sandboxProfile(canonicalRoot, executables, writable), executable, ...args],
    {
      cwd: canonicalRoot,
      env: {
        ...childEnvironment(canonicalRoot),
        BROWSERSLIST_ROOT_PATH: canonicalRoot,
        PATH: [
          ...new Set(executables.map((file) => path.dirname(file))),
          '/usr/bin',
          '/bin',
          '/usr/sbin',
          '/sbin',
        ].join(path.delimiter),
      },
      maxBuffer: 8 * 1024 ** 2,
      timeout: 60_000,
    },
  ).catch((error: Error & { code?: number | string; signal?: string; stderr?: string }) => {
    console.error('ISOLATED_PROCESS_FAILED', {
      code: error.code,
      signal: error.signal,
      stderr: error.stderr,
    });
    throw error;
  });
};
