import type { ChildProcess, SpawnOptions } from 'node:child_process';
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

const MAX_PORT_SCAN_ATTEMPTS = 100;

// Probe loopback addresses in addition to the wildcard: a server bound only to
// 127.0.0.1 would not conflict with a wildcard bind (SO_REUSEADDR on BSD), yet
// it still hijacks the localhost URLs every dev consumer actually hits.
const PROBE_HOSTS: (string | undefined)[] = ['127.0.0.1', '::1', undefined];

const canBind = (port: number, host?: string) =>
  new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      // An unavailable address family (e.g. no IPv6) is not "port busy".
      resolve(error.code !== 'EADDRINUSE' && error.code !== 'EACCES');
    });
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });

const isPortFree = async (port: number): Promise<boolean> => {
  for (const host of PROBE_HOSTS) {
    if (!(await canBind(port, host))) return false;
  }
  return true;
};

const findFreePort = async (startPort: number): Promise<number> => {
  for (let port = startPort; port < startPort + MAX_PORT_SCAN_ATTEMPTS; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${startPort}-${startPort + MAX_PORT_SCAN_ATTEMPTS - 1}`);
};

/**
 * Resolve the Next.js dev port.
 * Priority: -p CLI flag > PORT env var > first free port from 3010.
 * An explicitly requested port is used verbatim so conflicts fail loudly.
 */
const resolveNextPort = async (): Promise<number> => {
  const pIndex = process.argv.indexOf('-p');
  if (pIndex !== -1 && process.argv[pIndex + 1]) {
    return Number(process.argv[pIndex + 1]);
  }
  if (process.env.PORT) return Number(process.env.PORT);
  return findFreePort(3010);
};

/**
 * Resolve the port for the Vite dev server this orchestrator spawns and expose
 * it to children via env: the mode-specific listen var consumed by
 * vite.config.ts, plus VITE_DEV_PORT — the single contract the Next side reads
 * to locate the Vite dev server (no fs port file involved).
 */
const resolveVitePortEnv = async (): Promise<number> => {
  const isMobile = process.env.MOBILE === 'true';
  const envName = isMobile ? 'MOBILE_SPA_PORT' : 'SPA_PORT';
  const explicit = Number(process.env[envName]);
  const port = explicit || (await findFreePort(isMobile ? 3012 : 9876));

  process.env[envName] = String(port);
  process.env.VITE_DEV_PORT = String(port);

  return port;
};

const NEXT_READY_TIMEOUT_MS = 180_000;
const NEXT_READY_RETRY_MS = 400;
const FORCE_KILL_TIMEOUT_MS = 5_000;

const packageScriptCommand = 'bun';

let nextPort = 3010;
let nextRootUrl = `http://${NEXT_HOST}:${nextPort}/`;
let nextProcess: ChildProcess | undefined;
let viteProcess: ChildProcess | undefined;
let nextHandle: DevProcessHandle | undefined;
let viteHandle: DevProcessHandle | undefined;
let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
let shuttingDown = false;

const createPackageScriptProcessConfig = ({
  isWindows,
  scriptName,
}: {
  isWindows: boolean;
  scriptName: string;
}): { args: string[]; command: string; options: SpawnOptions } => ({
  args: ['run', scriptName],
  command: packageScriptCommand,
  options: {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  },
});

const runPackageScript = (scriptName: string) => {
  const { args, command, options } = createPackageScriptProcessConfig({ isWindows, scriptName });

  return spawn(command, args, options);
};

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
  nextPort = await resolveNextPort();
  process.env.PORT = String(nextPort);
  nextRootUrl = `http://${NEXT_HOST}:${nextPort}/`;
  const vitePort = await resolveVitePortEnv();
  console.log(`🔌 dev ports — next: ${nextPort}, vite: ${vitePort}`);

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

  nextProcess = spawn('bunx', ['next', 'dev', '-p', String(nextPort)], {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });
  nextHandle = createDevProcessHandle({ isWindows, pid: nextProcess.pid });
  watchChildExit(nextProcess, 'next');

  viteProcess = runPackageScript('dev:spa');
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
  createPackageScriptProcessConfig,
  createDevProcessHandle,
  findFreePort,
  resolveNextPort,
  resolveVitePortEnv,
  sendSignalToDevProcess,
};

if (isMainModule()) {
  void main().catch((error) => {
    console.error('❌ dev startup sequence failed:', error);
    shutdownAll('SIGTERM');
  });
}
