import { exec } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createLogger } from '@/utils/logger';

import { getCliWrapperDir } from './generateCliWrapper';

const execPromise = promisify(exec);
const logger = createLogger('modules:cliEmbedding:path');

const PATH_COMMENT = '# Added by LobeHub Desktop - CLI PATH';

export async function isCliInPath(): Promise<boolean> {
  const wrapperDir = getCliWrapperDir();

  if (process.platform === 'win32') {
    return isCliInWindowsPath(wrapperDir);
  }

  return isCliInUnixPath(wrapperDir);
}

export async function installCliToPath(): Promise<{ message: string; success: boolean }> {
  const wrapperDir = getCliWrapperDir();

  if (await isCliInPath()) {
    return { message: 'CLI already in PATH', success: true };
  }

  if (process.platform === 'win32') {
    return installToWindowsPath(wrapperDir);
  }

  return installToUnixPath(wrapperDir);
}

// ---- Unix ----

async function getShellProfile(): Promise<string> {
  const shell = process.env.SHELL || '/bin/bash';
  const home = homedir();

  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (shell.includes('fish')) return path.join(home, '.config', 'fish', 'config.fish');
  return path.join(home, '.bashrc');
}

async function isCliInUnixPath(wrapperDir: string): Promise<boolean> {
  const profilePath = await getShellProfile();
  try {
    const content = await readFile(profilePath, 'utf8');
    return content.includes(wrapperDir);
  } catch {
    return false;
  }
}

async function installToUnixPath(
  wrapperDir: string,
): Promise<{ message: string; success: boolean }> {
  const profilePath = await getShellProfile();

  try {
    let content = '';
    try {
      content = await readFile(profilePath, 'utf8');
    } catch {
      // File doesn't exist, will be created
    }

    const exportLine = `export PATH="${wrapperDir}:$PATH"`;
    const addition = `\n${PATH_COMMENT}\n${exportLine}\n`;
    await writeFile(profilePath, content + addition, 'utf8');
    logger.info(`Added CLI to PATH in ${profilePath}`);
    return {
      message: `Added to ${profilePath}. Restart your terminal to use \`lobe\`.`,
      success: true,
    };
  } catch (error) {
    logger.error('Failed to install CLI to PATH:', error);
    return { message: `Failed to write ${profilePath}: ${error}`, success: false };
  }
}

// ---- Windows ----

async function isCliInWindowsPath(wrapperDir: string): Promise<boolean> {
  try {
    const { stdout } = await execPromise('reg query "HKCU\\Environment" /v Path', {
      timeout: 5000,
    });
    return stdout.includes(wrapperDir);
  } catch {
    return false;
  }
}

async function installToWindowsPath(
  wrapperDir: string,
): Promise<{ message: string; success: boolean }> {
  try {
    let currentPath = '';
    try {
      const { stdout } = await execPromise('reg query "HKCU\\Environment" /v Path', {
        timeout: 5000,
      });
      const match = stdout.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/);
      if (match) currentPath = match[1].trim();
    } catch {
      // PATH key doesn't exist yet
    }

    const newPath = currentPath ? `${currentPath};${wrapperDir}` : wrapperDir;
    await execPromise(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`, {
      timeout: 5000,
    });

    // Broadcast WM_SETTINGCHANGE so new terminals pick up the change
    await execPromise(
      `powershell -Command "[System.Environment]::SetEnvironmentVariable('Path', [System.Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"`,
      { timeout: 5000 },
    );

    logger.info('Added CLI to Windows user PATH');
    return {
      message: 'Added to user PATH. New terminals will have `lobe` available.',
      success: true,
    };
  } catch (error) {
    logger.error('Failed to install CLI to Windows PATH:', error);
    return { message: `Failed to update registry: ${error}`, success: false };
  }
}
