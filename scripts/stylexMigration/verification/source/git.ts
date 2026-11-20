import { execFile } from 'node:child_process';

/** No shell interpolation; ignore ambient Git overrides that can change the repository. */
export const gitEnvironment = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});

export const git = (directory: string, args: string[], input?: string) =>
  new Promise<Buffer>((resolve, reject) => {
    const child = execFile(
      'git',
      ['--no-replace-objects', '-c', 'core.hooksPath=/dev/null', ...args],
      {
        cwd: directory,
        encoding: 'buffer',
        env: gitEnvironment(),
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(input);
  });
