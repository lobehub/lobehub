import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type AgentBrowserExec, runAgentBrowserCall } from '@lobechat/device-control/agent-browser';

/** How this device runs the browser tool: an `agent-browser` binary. */
export interface BrowserDevice {
  binaryPath: string;
}

// Covers a slow first launch of the browser plus a page load.
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
// Topic sessions nobody drives any more shut their browser down on their own.
const IDLE_TIMEOUT = '10m';
const CLOSE_TIMEOUT_MS = 10_000;
/** Keeps LobeHub's daemons and sessions apart from the user's own agent-browser use. */
const NAMESPACE = 'lobehub';

/**
 * The user's agent-browser setup must not reach the model: a profile, saved
 * state, CDP target, cloud provider or headed mode from
 * `~/.agent-browser/config.json`, `./agent-browser.json` or `AGENT_BROWSER_*`
 * would hand it a signed-in or visible browser, while the tool promises a
 * clean headless one. So every run gets an empty config, no `AGENT_BROWSER_*`
 * variables, and explicit headless settings.
 */
const isolatedEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('AGENT_BROWSER_')),
  );

const isolationArgs = (configPath: string) => [
  '--namespace',
  NAMESPACE,
  '--config',
  configPath,
  '--headed',
  'false',
  '--idle-timeout',
  IDLE_TIMEOUT,
];

/** cmd.exe expands or splits on these even inside double quotes. */
const CMD_UNSAFE = /["%!^\r\n]/;

/**
 * argv for a `.cmd` shim, which Windows only starts through cmd.exe. With
 * `shell: true` Node joins argv into one command line, so every element is
 * double-quoted (the temp `--config` path can contain spaces) and one that
 * cmd.exe would still interpret is refused rather than escaped. Only the
 * sanitized session name and our own temp paths reach argv; page text and
 * other model input travel over stdin.
 */
export const toCmdShellArgv = (binaryPath: string, args: string[]) => {
  const quoted = [binaryPath, ...args].map((arg) => {
    if (CMD_UNSAFE.test(arg)) throw new Error(`Unsafe argument for agent-browser: ${arg}`);
    return `"${arg}"`;
  });
  return { args: quoted.slice(1), command: quoted[0] };
};

const spawnAgentBrowser = (binaryPath: string, args: string[], timeoutMs: number) => {
  const viaShell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binaryPath);
  const argv = viaShell ? toCmdShellArgv(binaryPath, args) : { args, command: binaryPath };
  return spawn(argv.command, argv.args, {
    cwd: os.tmpdir(),
    env: isolatedEnv(),
    shell: viaShell,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });
};

const isExecutableFile = async (filePath: string) => {
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats?.isFile()) return false;
  return access(filePath, constants.X_OK).then(
    () => true,
    () => false,
  );
};

const findOnPath = async (name: string): Promise<string | undefined> => {
  // A real `.exe` needs no shell; the npm `.cmd` shim is the fallback.
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
};

/**
 * Enables the `lobe-browser` tool for `lh connect`. `--agent-browser <binary>`
 * names the binary and fails if it is missing; otherwise an `agent-browser` on
 * PATH is used, and without one the device does not advertise the tool.
 *
 * The browser is headless with a clean profile per topic — unlike the desktop
 * app's panel, the user cannot watch it and it carries no sign-ins.
 */
export const resolveBrowserDevice = async (
  binary: string | undefined,
): Promise<BrowserDevice | undefined> => {
  if (binary) {
    const binaryPath = path.resolve(binary);
    if (!(await isExecutableFile(binaryPath))) {
      throw new Error(`--agent-browser: ${binaryPath} is not an executable file`);
    }
    return { binaryPath };
  }
  const found = await findOnPath('agent-browser');
  return found ? { binaryPath: found } : undefined;
};

/** One `agent-browser batch` run with the commands on stdin; see {@link AgentBrowserExec}. */
const createExec =
  (binaryPath: string, timeoutMs: number, configPath: string): AgentBrowserExec =>
  (session, commands) =>
    new Promise((resolve, reject) => {
      const child = spawnAgentBrowser(
        binaryPath,
        [...isolationArgs(configPath), '--session', session, '--json', 'batch', '--bail'],
        timeoutMs,
      );
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let size = 0;
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT_BYTES) child.kill();
        else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', reject);
      child.on('close', (code, signal) => {
        const out = Buffer.concat(stdout).toString('utf8').trim();
        // A failed step still prints the JSON array (and exits 1); keep it.
        if (out.startsWith('[')) return resolve(out);
        const err = Buffer.concat(stderr).toString('utf8').trim();
        reject(
          new Error(
            signal
              ? `agent-browser was stopped (${signal}) after ${timeoutMs}ms`
              : `agent-browser exited with ${code}: ${err || out || 'no output'}`,
          ),
        );
      });
      child.stdin.end(JSON.stringify(commands));
    });

/**
 * Runs one `lobe-browser` tool call with the device's `agent-browser` and
 * returns the same tool result the desktop app does.
 */
export const executeBrowserCall = async (
  device: BrowserDevice | undefined,
  apiName: string,
  argsStr: string,
  timeout?: number,
) => {
  if (!device) {
    return {
      content: '',
      error:
        'The browser tool is not enabled on this device. Install agent-browser (`npm i -g agent-browser && agent-browser install`) and restart `lh connect`.',
      state: undefined,
      success: false,
    };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'lh-browser-'));
  try {
    const args = JSON.parse(argsStr || '{}') as Record<string, unknown>;
    const timeoutMs = typeof timeout === 'number' && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS;
    const configPath = path.join(dir, 'agent-browser.json');
    await writeFile(configPath, '{}');
    return await runAgentBrowserCall(apiName, args, {
      exec: createExec(device.binaryPath, timeoutMs, configPath),
      readFile,
      screenshotPath: path.join(dir, 'screenshot.png'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', error: message, state: undefined, success: false };
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => {});
  }
};

/**
 * Closes every browser `lh connect` opened (`close --all` stays inside the
 * LobeHub namespace), so stopping the device does not leave Chrome running
 * until each session's idle timeout. Best-effort: resolves even on failure.
 */
export const closeBrowserSessions = async (device: BrowserDevice | undefined) => {
  if (!device) return;
  await new Promise<void>((resolve) => {
    const child = spawnAgentBrowser(
      device.binaryPath,
      ['--namespace', NAMESPACE, 'close', '--all'],
      CLOSE_TIMEOUT_MS,
    );
    child.on('error', () => resolve());
    child.on('close', () => resolve());
    child.stdin.end();
  }).catch(() => {});
};
