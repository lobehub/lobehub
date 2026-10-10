import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Run outside the bundler process so the compiler's graph memory is released before bundling. */
export const prepareServerI18n = async (root: string) => {
  const { stdout } = await execute(
    'node',
    [
      '--max-old-space-size=6144',
      '--import',
      'tsx',
      path.join(repoRoot, 'scripts/serverI18n/index.ts'),
    ],
    {
      cwd: root,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (stdout) console.info(stdout.trim());
};

export const watchServerI18n = async (root: string, sourceRoot = repoRoot) => {
  const directories = new Set<string>();
  for (const base of new Set([root, sourceRoot]))
    for (const directory of ['src', 'apps/server', 'packages', 'locales']) {
      try {
        directories.add(await realpath(path.join(base, directory)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  let timer: ReturnType<typeof setTimeout>;
  let pending = Promise.resolve();
  const watchers = [...directories].map((directory) =>
    watch(directory, { recursive: true }, (_event, filename) => {
      if (
        !filename ||
        filename.includes('node_modules') ||
        filename.includes('/generated/') ||
        filename.includes('/dist/') ||
        /\.(?:test|spec)\./.test(filename) ||
        !/\.(?:ts|tsx|json)$/.test(filename)
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending = pending
          .then(() => prepareServerI18n(root))
          .catch(async (error) => {
            // Do not keep serving stale translations after a failed extraction.
            await rm(path.join(sourceRoot, 'src/libs/i18n/server/generated/resources.js'), {
              force: true,
            });
            console.error('Server i18n extraction failed:', error);
          });
      }, 300);
    }),
  );
  return () => {
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
};
