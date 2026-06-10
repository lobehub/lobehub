import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

interface DevProcessHandle {
  directPid?: number;
  groupPid?: number;
  isWindows: boolean;
}

const isWindows = process.platform === 'win32';

const NEXT_HOST = 'localhost';

/**
 * Resolve the Next.js dev port.
 * Priority: -p CLI flag > PORT env var > 3010.
 */
const resolveNextPort = (): number => {
  const pIndex = process.argv.indexOf('-p');
  if (pIndex !== -1 && process.argv[pIndex + 1]) {
    return Number(process.argv[pIndex + 1]);
  }
  if (process.env.PORT) return Number(process.env.PORT);
  return 3010;
};

const NEXT_READY_TIMEOUT_MS = 180_000;
const NEXT_READY_RETRY_MS = 400;
const FORCE_KILL_TIMEOUT_MS = 5_000;

const npmCommand = isWindows ? 'npm.cmd' : 'npm';

let nextPort = 3010;
let nextRootUrl = `http://${NEXT_HOST}:${nextPort}/`;
let nextProcess: ChildProcess | undefined;
let viteProcess: ChildProcess | undefined;
let nextHandle: DevProcessHandle | undefined;
let viteHandle: DevProcessHandle | undefined;
let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;

const runNpmScript = (scriptName: string) =>
  spawn(npmCommand, ['run', scriptName], {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });

const loadEnv = () => {
  const env = process.env.NODE_ENV || 'development';
  const shellEnv = Object.entries(process.env).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value;
      return acc;
    },
    {},
  );
  const dotenvEnv: Record<string, string> = {};
  const dotenvResult = dotenv.config({
    override: true,
    path: ['.env', `.env.${env}`, `.env.${env}.local`],
    processEnv: dotenvEnv,
  });

  if (!dotenvResult.parsed) return;

  const expanded = dotenvExpand.expand({
    parsed: dotenvResult.parsed,
    processEnv: { ...dotenvEnv, ...shellEnv },
  });

  Object.assign(process.env, expanded.parsed, shellEnv);
};

const createDevProcessHandle = ({
  isWindows,
  pid,
}: {
  isWindows: boolean;
  pid?: number;
}): DevProcessHandle => ({
  directPid: pid,
  groupPid: isWindows ? undefined : pid,
  isWindows,
});

const sendSignalToDevProcess = (handle: DevProcessHandle | undefined, signal: NodeJS.Signals) => {
  if (!handle) return;

  if (!handle.isWindows && handle.groupPid) {
    try {
      process.kill(-handle.groupPid, signal);
      return;
    } catch {
      // Fall through to the direct child pid below. The wrapper may already be
      // gone while its process group has been reaped.
    }
  }

  if (!handle.directPid) return;

  try {
    process.kill(handle.directPid, signal);
  } catch {
    // The process already exited.
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isPortOpen = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    const onDone = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.once('connect', () => onDone(true));
    socket.once('error', () => onDone(false));
    socket.setTimeout(1_000, () => onDone(false));
  });

const waitForNextReady = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < NEXT_READY_TIMEOUT_MS) {
    if (await isPortOpen(NEXT_HOST, nextPort)) return;
    await wait(NEXT_READY_RETRY_MS);
  }

  throw new Error(
    `Next server was not ready within ${NEXT_READY_TIMEOUT_MS / 1000}s on ${NEXT_HOST}:${nextPort}`,
  );
};

const prewarmNextRootCompile = async () => {
  const startedAt = Date.now();
  const response = await fetch(nextRootUrl, { signal: AbortSignal.timeout(120_000) });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `✅ Next prewarm request finished (${response.status}) in ${elapsed}s ${nextRootUrl}`,
  );
};

const runNextBackgroundTasks = () => {
  setTimeout(() => {
    console.log(`🔁 Next server URL: ${nextRootUrl}`);
  }, 2_000);

  void (async () => {
    try {
      await waitForNextReady();
      await prewarmNextRootCompile();
    } catch (error) {
      console.warn('⚠️ Next prewarm skipped:', error);
    }
  })();
};

const terminateChildren = () => {
  sendSignalToDevProcess(viteHandle, 'SIGTERM');
  sendSignalToDevProcess(nextHandle, 'SIGTERM');
};

const forceKillChildren = () => {
  sendSignalToDevProcess(viteHandle, 'SIGKILL');
  sendSignalToDevProcess(nextHandle, 'SIGKILL');
};

const clearForceKillTimer = () => {
  if (!forceKillTimer) return;
  clearTimeout(forceKillTimer);
  forceKillTimer = undefined;
};

const hasChildSettled = (child?: ChildProcess) =>
  !child || child.exitCode !== null || child.signalCode !== null;

const clearForceKillTimerWhenChildrenSettle = () => {
  if (!shuttingDown) return;
  if (hasChildSettled(nextProcess) && hasChildSettled(viteProcess)) clearForceKillTimer();
};

const shutdownAll = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    forceKillChildren();
    return;
  }
  shuttingDown = true;

  terminateChildren();

  process.exitCode = signal === 'SIGINT' ? 130 : 143;

  forceKillTimer = setTimeout(() => {
    forceKillTimer = undefined;
    forceKillChildren();
  }, FORCE_KILL_TIMEOUT_MS);
};

const watchChildExit = (child: ChildProcess, name: 'next' | 'vite') => {
  child.once('exit', (code, signal) => {
    if (shuttingDown) {
      clearForceKillTimerWhenChildrenSettle();
      return;
    }

    console.error(
      `❌ ${name} exited unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`,
    );
    shutdownAll('SIGTERM');
  });
};

const main = async () => {
  loadEnv();
  nextPort = resolveNextPort();
  nextRootUrl = `http://${NEXT_HOST}:${nextPort}/`;

  const forwardedSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of forwardedSignals) {
    process.on(sig, () => shutdownAll(sig));
  }

  process.on('uncaughtException', (error) => {
    console.error('❌ uncaught exception in dev startup:', error);
    shutdownAll('SIGTERM');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandled rejection in dev startup:', reason);
    shutdownAll('SIGTERM');
  });

  process.on('exit', () => {
    forceKillChildren();
  });

  nextProcess = spawn('npx', ['next', 'dev', '-p', String(nextPort)], {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });
  nextHandle = createDevProcessHandle({ isWindows, pid: nextProcess.pid });
  watchChildExit(nextProcess, 'next');

  viteProcess = runNpmScript('dev:spa');
  viteHandle = createDevProcessHandle({ isWindows, pid: viteProcess.pid });
  watchChildExit(viteProcess, 'vite');
  runNextBackgroundTasks();

  await Promise.race([
    new Promise((resolve) => nextProcess?.once('exit', resolve)),
    new Promise((resolve) => viteProcess?.once('exit', resolve)),
  ]);
};

const isMainModule = () => {
  const entry = process.argv[1];
  return !!entry && import.meta.url === pathToFileURL(path.resolve(entry)).href;
};

export const __testing = {
  createDevProcessHandle,
  sendSignalToDevProcess,
};

if (isMainModule()) {
  void main().catch((error) => {
    console.error('❌ dev startup sequence failed:', error);
    shutdownAll('SIGTERM');
  });
}
