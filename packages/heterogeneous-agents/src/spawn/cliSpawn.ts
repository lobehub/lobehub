import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import path from 'node:path';

const WINDOWS_EXE_EXT_PATTERN = /\.exe$/i;
const WINDOWS_NODE_EXE_PATTERN = /(?:^|[\\/])node(?:\.exe)?$/i;

export interface CliSpawnPlan {
  args: string[];
  command: string;
}

interface WindowsShimTarget {
  argsPrefix?: string[];
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

const pickWindowsNodeExecutable = (candidates: string[]): string | undefined =>
  candidates.find(
    (candidate) =>
      WINDOWS_EXE_EXT_PATTERN.test(candidate) && WINDOWS_NODE_EXE_PATTERN.test(candidate),
  );

const joinShimRelativePath = (shimPath: string, relativePath: string) =>
  path.win32.join(
    path.win32.dirname(shimPath),
    ...relativePath.replaceAll('\\', '/').split('/').filter(Boolean),
  );

const resolveShimPathToken = (shimPath: string, token: string): string | undefined => {
  const trimmedToken = token.trim().replaceAll(/^['"]|['"]$/g, '');
  const lowerToken = trimmedToken.toLowerCase();

  if (lowerToken.startsWith('$basedir')) {
    return joinShimRelativePath(
      shimPath,
      trimmedToken.slice('$basedir'.length).replace(/^[\\/]/, ''),
    );
  }

  if (lowerToken.startsWith('%dp0%')) {
    return joinShimRelativePath(shimPath, trimmedToken.slice('%dp0%'.length).replace(/^[\\/]/, ''));
  }

  if (path.win32.isAbsolute(trimmedToken)) return trimmedToken;

  if (/[\\/]/.test(trimmedToken)) return joinShimRelativePath(shimPath, trimmedToken);
};

const getExistingShimPathToken = async (
  shimPath: string,
  token: string,
): Promise<string | undefined> => {
  const resolvedPath = resolveShimPathToken(shimPath, token);
  if (!resolvedPath) return;
  return (await fileExists(resolvedPath)) ? resolvedPath : undefined;
};

const resolveWindowsNodeCommand = async (shimPath: string): Promise<string | undefined> => {
  const localNodePath = path.win32.join(path.win32.dirname(shimPath), 'node.exe');
  if (await fileExists(localNodePath)) return localNodePath;

  try {
    const stdout = await execFileString('where', ['node']);
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return pickWindowsNodeExecutable(candidates);
  } catch {
    return;
  }
};

const getNodeCommand = async (shimPath: string, token: string): Promise<string | undefined> => {
  const trimmedToken = token.trim().replaceAll(/^['"]|['"]$/g, '');
  if (/^node(?:\.exe)?$/i.test(trimmedToken) || /^%_prog%$/i.test(trimmedToken)) {
    return resolveWindowsNodeCommand(shimPath);
  }

  const resolvedPath = await getExistingShimPathToken(shimPath, trimmedToken);
  if (!resolvedPath) return;

  return WINDOWS_NODE_EXE_PATTERN.test(resolvedPath) ? resolvedPath : undefined;
};

const getNodeScriptTarget = async (
  shimPath: string,
  nodeToken: string,
  scriptToken: string,
): Promise<WindowsShimTarget | undefined> => {
  const command = await getNodeCommand(shimPath, nodeToken);
  if (!command) return;

  const scriptPath = await getExistingShimPathToken(shimPath, scriptToken);
  if (!scriptPath) return;

  return { argsPrefix: [scriptPath], command };
};

const inferWindowsNodeScriptFromShim = async (
  shimPath: string,
  source: string,
): Promise<WindowsShimTarget | undefined> => {
  const patterns: Array<RegExp | [RegExp, string]> = [
    /exec\s+"(\$basedir[^"]*node(?:\.exe)?)"\s+"([^"]+)"/i,
    /exec\s+(node(?:\.exe)?)\s+"([^"]+)"/i,
    /"(%dp0%[^"]*node(?:\.exe)?)"\s+"([^"]+)"/i,
    /"(%_prog%)"\s+"([^"]+)"/i,
    [/(?:^|\r?\n)\s*(node(?:\.exe)?)\s+"([^"]+)"/i, 'node'],
  ];

  for (const pattern of patterns) {
    const regex = Array.isArray(pattern) ? pattern[0] : pattern;
    const match = source.match(regex);
    if (!match) continue;

    const nodeToken = Array.isArray(pattern) ? pattern[1] : match[1];
    const scriptToken = Array.isArray(pattern) ? match[2] : match[2];
    if (!nodeToken || !scriptToken) continue;

    const target = await getNodeScriptTarget(shimPath, nodeToken, scriptToken);
    if (target) return target;
  }
};

const inferWindowsExecutableFromShim = async (
  shimPath: string,
  source: string,
): Promise<WindowsShimTarget | undefined> => {
  const matches = [
    ...source.matchAll(/\$basedir[\\/]([^"\s]+?\.exe)/gi),
    ...source.matchAll(/%dp0%\\([^"\r\n]+?\.exe)/gi),
  ];

  for (const match of matches) {
    const relativePath = match[1]?.replaceAll('\\', '/');
    if (!relativePath || WINDOWS_NODE_EXE_PATTERN.test(relativePath)) continue;

    const command = joinShimRelativePath(shimPath, relativePath);
    if (await fileExists(command)) return { command };
  }
};

const inferWindowsNpmShimTarget = async (
  shimPath: string,
): Promise<WindowsShimTarget | undefined> => {
  if (WINDOWS_EXE_EXT_PATTERN.test(shimPath)) return { command: shimPath };
  if (!(await fileExists(shimPath))) return;

  try {
    const source = await readFile(shimPath, 'utf8');
    return (
      (await inferWindowsNodeScriptFromShim(shimPath, source)) ??
      (await inferWindowsExecutableFromShim(shimPath, source))
    );
  } catch {
    return;
  }
};

const resolveWindowsBareCommand = async (
  command: string,
): Promise<WindowsShimTarget | undefined> => {
  try {
    const stdout = await execFileString('where', [command]);
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const executable = pickWindowsExecutable(candidates);
    if (executable) return { command: executable };

    for (const candidate of candidates) {
      const target = await inferWindowsNpmShimTarget(candidate);
      if (target) return target;
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

  const target = isPathLikeCommand(trimmedCommand)
    ? await inferWindowsNpmShimTarget(trimmedCommand)
    : await resolveWindowsBareCommand(trimmedCommand);

  if (!target) return { args, command };

  return { args: [...(target.argsPrefix ?? []), ...args], command: target.command };
};
