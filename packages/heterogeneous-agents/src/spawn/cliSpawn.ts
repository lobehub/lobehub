import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import path from 'node:path';

const WINDOWS_EXE_EXT_PATTERN = /\.exe$/i;
// `CreateProcess` limit, which is what this plan is spawned through: the plan
// always names a real executable (an `.exe`, or `node.exe` plus the script a
// shim pointed at), never a shell. Routing it through cmd.exe instead would
// drop the ceiling to 8191 — and hand the prompt and conversation context to
// cmd.exe for a second round of parsing (CVE-2024-27980). Detection probes a
// `.cmd` we can't unwrap through `%ComSpec%` under its own 8191 check; the
// launch path deliberately does not.
const WINDOWS_MAX_COMMAND_LINE_LENGTH = 32_767;
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

const quoteWindowsCommandLineArgument = (argument: string): string => {
  if (argument && !/[\t "]/u.test(argument)) return argument;

  let quoted = '"';
  let backslashCount = 0;

  for (const character of argument) {
    if (character === '\\') {
      backslashCount += 1;
      continue;
    }

    if (character === '"') {
      quoted += `${'\\'.repeat(backslashCount * 2 + 1)}"`;
    } else {
      quoted += `${'\\'.repeat(backslashCount)}${character}`;
    }
    backslashCount = 0;
  }

  return `${quoted}${'\\'.repeat(backslashCount * 2)}"`;
};

const assertWindowsCommandLineFits = ({ args, command }: CliSpawnPlan): void => {
  const commandLineLength = [command, ...args]
    .map(quoteWindowsCommandLineArgument)
    .join(' ').length;
  const requiredLength = commandLineLength + 1;
  if (requiredLength <= WINDOWS_MAX_COMMAND_LINE_LENGTH) return;

  throw new Error(
    `Cannot start CLI because the resolved Windows command line requires ${requiredLength} UTF-16 code units; Windows permits at most ${WINDOWS_MAX_COMMAND_LINE_LENGTH} including the terminator. Shorten the prompt or conversation context and retry.`,
  );
};

export const isPathLikeCommand = (command: string) =>
  path.win32.isAbsolute(command) || path.posix.isAbsolute(command) || /[\\/]/.test(command);

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const execFileString = async (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { env, timeout: 3000, windowsHide: true },
      (error: Error | null, stdout: string) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString());
      },
    );
  });

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

  const shimDirectoryPrefix = lowerToken.startsWith('%~dp0')
    ? '%~dp0'
    : lowerToken.startsWith('%dp0%')
      ? '%dp0%'
      : undefined;
  if (shimDirectoryPrefix) {
    return joinShimRelativePath(
      shimPath,
      trimmedToken.slice(shimDirectoryPrefix.length).replace(/^[\\/]/, ''),
    );
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

const resolveWindowsNodeCommand = async (
  shimPath: string,
  env?: NodeJS.ProcessEnv,
): Promise<string | undefined> => {
  const localNodePath = path.win32.join(path.win32.dirname(shimPath), 'node.exe');
  if (await fileExists(localNodePath)) return localNodePath;

  try {
    const stdout = await execFileString('where', ['node'], env);
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return pickWindowsNodeExecutable(candidates);
  } catch {
    return;
  }
};

const getNodeCommand = async (
  shimPath: string,
  token: string,
  env?: NodeJS.ProcessEnv,
): Promise<string | undefined> => {
  const trimmedToken = token.trim().replaceAll(/^['"]|['"]$/g, '');
  if (/^node(?:\.exe)?$/i.test(trimmedToken) || /^%_prog%$/i.test(trimmedToken)) {
    return resolveWindowsNodeCommand(shimPath, env);
  }

  const resolvedPath = await getExistingShimPathToken(shimPath, trimmedToken);
  if (!resolvedPath) return;

  return WINDOWS_NODE_EXE_PATTERN.test(resolvedPath) ? resolvedPath : undefined;
};

const getNodeScriptTarget = async (
  shimPath: string,
  nodeToken: string,
  scriptToken: string,
  env?: NodeJS.ProcessEnv,
): Promise<WindowsShimTarget | undefined> => {
  const command = await getNodeCommand(shimPath, nodeToken, env);
  if (!command) return;

  const scriptPath = await getExistingShimPathToken(shimPath, scriptToken);
  if (!scriptPath) return;

  return { argsPrefix: [scriptPath], command };
};

const inferWindowsNodeScriptFromShim = async (
  shimPath: string,
  source: string,
  env?: NodeJS.ProcessEnv,
): Promise<WindowsShimTarget | undefined> => {
  const patterns: Array<RegExp | [RegExp, string]> = [
    /exec\s+"(\$basedir[^"]*node(?:\.exe)?)"\s+"([^"]+)"/i,
    /exec\s+(node(?:\.exe)?)\s+"([^"]+)"/i,
    /"(%(?:~dp0|dp0%)[^"]*node(?:\.exe)?)"\s+"([^"]+)"/i,
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

    const target = await getNodeScriptTarget(shimPath, nodeToken, scriptToken, env);
    if (target) return target;
  }
};

const inferWindowsExecutableFromShim = async (
  shimPath: string,
  source: string,
): Promise<WindowsShimTarget | undefined> => {
  const matches = [
    ...source.matchAll(/\$basedir[\\/]([^"\s]+?\.exe)/gi),
    ...source.matchAll(/%(?:~dp0|dp0%)[\\/]?([^"\r\n]+?\.exe)/gi),
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
  env?: NodeJS.ProcessEnv,
): Promise<WindowsShimTarget | undefined> => {
  if (WINDOWS_EXE_EXT_PATTERN.test(shimPath)) return { command: shimPath };
  if (!(await fileExists(shimPath))) return;

  try {
    const source = await readFile(shimPath, 'utf8');
    return (
      (await inferWindowsNodeScriptFromShim(shimPath, source, env)) ??
      (await inferWindowsExecutableFromShim(shimPath, source))
    );
  } catch {
    return;
  }
};

const resolveWindowsBareCommand = async (
  command: string,
  env?: NodeJS.ProcessEnv,
): Promise<WindowsShimTarget | undefined> => {
  try {
    const stdout = await execFileString('where', [command], env);
    const candidates = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    // Walk candidates in PATH order — `inferWindowsNpmShimTarget` already
    // returns a bare `.exe` as-is and unwraps a `.cmd`/`.bat`/extensionless
    // shim via static parsing. Do NOT pre-scan for any `.exe` first: an
    // earlier `.cmd` shim that resolves to a real target must win over a
    // later bare `.exe`, e.g. a WinGet-installed `codex.cmd` ahead of the
    // `WindowsApps\...` App Execution Alias stub some MSIX-packaged tools
    // (e.g. the Codex desktop app) also add to PATH — Node's execFile/spawn
    // throws EPERM on that stub, so picking it over an earlier working shim
    // breaks CLI launch. Same PATH-order rule already applied to detection
    // candidates in resolveCliCommand.ts (see #17376).
    for (const candidate of candidates) {
      const target = await inferWindowsNpmShimTarget(candidate, env);
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
  env?: NodeJS.ProcessEnv,
): Promise<CliSpawnPlan> => {
  const trimmedCommand = command.trim();
  if (!isWindows() || !trimmedCommand) return { args, command };

  const target = isPathLikeCommand(trimmedCommand)
    ? await inferWindowsNpmShimTarget(trimmedCommand, env)
    : await resolveWindowsBareCommand(trimmedCommand, env);

  const spawnPlan = target
    ? { args: [...(target.argsPrefix ?? []), ...args], command: target.command }
    : { args, command };

  assertWindowsCommandLineFits(spawnPlan);
  return spawnPlan;
};
