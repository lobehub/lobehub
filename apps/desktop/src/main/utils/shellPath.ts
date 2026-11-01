import { execFile } from 'node:child_process';

const SHELL_PATH_DELIMITER = '__LOBE_SHELL_PATH__';
const SHELL_PATH_TIMEOUT_MS = 5000;

const runLoginShell = (shell: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      shell,
      ['-ilc', `printf '${SHELL_PATH_DELIMITER}%s${SHELL_PATH_DELIMITER}' "$PATH"; exit`],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
        },
        timeout: SHELL_PATH_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });

/**
 * Refresh PATH from the user's login shell without blocking Electron's main
 * thread. The existing PATH is retained when the shell cannot be resolved or
 * returns no usable value.
 */
export const refreshShellPath = async (): Promise<void> => {
  if (process.platform === 'win32') return;

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  const stdout = await runLoginShell(shell);
  const [, shellPath] = stdout.split(SHELL_PATH_DELIMITER);

  if (shellPath?.trim()) process.env.PATH = shellPath.trim();
};
