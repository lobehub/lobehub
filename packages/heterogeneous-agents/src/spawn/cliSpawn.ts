import type { ChildProcess, SpawnOptionsWithoutStdio } from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import path from 'node:path';

const WINDOWS_EXE_EXT_PATTERN = /\.exe$/i;

export interface CliSpawnPlan {
  args: string[];
  command: string;
}

const isWindows = () => platform() === 'win32';

const isPathLikeCommand = (command: string) =>
  path.win32.isAbsolute(command) || path.posix.isAbsolute(command) || /[\\/]/.test(command);

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const execFileString = async (command: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 3000, windowsHide: true },
      (error: Error | null, stdout: string) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString());
      },
    );
  });

const pickWindowsExecutable = (candidates: string[]): string | undefined =>
  candidates.find((candidate) => WINDOWS_EXE_EXT_PATTERN.test(candidate));

const inferWindowsNpmBinaryFromShim = async (shimPath: string): Promise<string | undefined> => {
  if (WINDOWS_EXE_EXT_PATTERN.test(shimPath)) return shimPath;
  if (!(await fileExists(shimPath))) return;

  try {
    const source = await readFile(shimPath, 'utf8');
    const extensionlessMatch = source.match(/exec\s+"\$basedir\/([^"]+\.exe)"/i);
    const cmdMatch = source.match(/"%dp0%\\([^\r\n"]+\.exe)"/i);
    const relativeBinaryPath = extensionlessMatch?.[1] ?? cmdMatch?.[1]?.replaceAll('\\', '/');
    if (!relativeBinaryPath) return;

    const binaryPath = path.win32.join(
      path.win32.dirname(shimPath),
      ...relativeBinaryPath.split('/'),
    );
    return (await fileExists(binaryPath)) ? binaryPath : undefined;
  } catch {
    return;
  }
};

const resolveWindowsBareCommand = async (command: string): Promise<string | undefined> => {
  try {
    const stdout = await execFileString('where', [command]);
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const executable = pickWindowsExecutable(candidates);
    if (executable) return executable;

    for (const candidate of candidates) {
      const binaryPath = await inferWindowsNpmBinaryFromShim(candidate);
      if (binaryPath) return binaryPath;
    }

    return undefined;
  } catch {
    return;
  }
};

export const resolveCliSpawnPlan = async (
  command: string,
  args: string[],
): Promise<CliSpawnPlan> => {
  const trimmedCommand = command.trim();
  if (!isWindows() || !trimmedCommand) return { args, command };

  const resolvedCommand = isPathLikeCommand(trimmedCommand)
    ? ((await inferWindowsNpmBinaryFromShim(trimmedCommand)) ?? trimmedCommand)
    : ((await resolveWindowsBareCommand(trimmedCommand)) ?? trimmedCommand);

  return { args, command: resolvedCommand };
};

export const spawnCli = async (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): Promise<ChildProcess> => {
  const plan = await resolveCliSpawnPlan(command, args);
  return spawn(plan.command, plan.args, options);
};
