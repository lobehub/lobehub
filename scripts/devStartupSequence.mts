import { type ChildProcess, spawn } from 'node:child_process';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import net from 'node:net';

const env = process.env.NODE_ENV || 'development';
const isWindows = process.platform === 'win32';

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

if (dotenvResult.parsed) {
  const expanded = dotenvExpand.expand({
    parsed: dotenvResult.parsed,
    processEnv: { ...dotenvEnv, ...shellEnv },
  });

  Object.assign(process.env, expanded.parsed, shellEnv);
}

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

const NEXT_PORT = resolveNextPort();
const NEXT_ROOT_URL = `http://${NEXT_HOST}:${NEXT_PORT}/`;
const NEXT_READY_TIMEOUT_MS = 180_000;
const NEXT_READY_RETRY_MS = 400;
const FORCE_KILL_TIMEOUT_MS = 5_000;

const npmCommand = isWindows ? 'npm.cmd' : 'npm';

let nextProcess: ChildProcess | undefined;
let viteProcess: ChildProcess | undefined;
let shuttingDown = false;

const runNpmScript = (scriptName: string) =>
  spawn(npmCommand, ['run', scriptName], {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });

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
    if (await isPortOpen(NEXT_HOST, NEXT_PORT)) return;
    await wait(NEXT_READY_RETRY_MS);
  }

  throw new Error(
    `Next server was not ready within ${NEXT_READY_TIMEOUT_MS / 1000}s on ${NEXT_HOST}:${NEXT_PORT}`,
  );
};

const prewarmNextRootCompile = async () => {
  const startedAt = Date.now();
  const response = await fetch(NEXT_ROOT_URL, { signal: AbortSignal.timeout(120_000) });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`✅ Next prewarm request finished (${response.status}) in ${elapsed}s ${NEXT_ROOT_URL}`);
};

const runNextBackgroundTasks = () => {
  setTimeout(() => {
    console.log(`🔁 Next server URL: ${NEXT_ROOT_URL}`);
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

const isChildAlive = (child: ChildProcess) =>
  !child.killed && child.exitCode === null && child.signalCode === null;

const sendKillSignal = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (!isChildAlive(child) || !child.pid) return;
  try {
    if (!isWindows) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // process group kill failed; fall through to direct kill
      }
    }
    child.kill(signal);
  } catch {
    // child already gone
  }
};

const terminateChild = (child?: ChildProcess) => {
  if (!child) return;
  sendKillSignal(child, 'SIGTERM');
};

const forceKillChild = (child?: ChildProcess) => {
  if (!child) return;
  sendKillSignal(child, 'SIGKILL');
};

const shutdownAll = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;

  terminateChild(viteProcess);
  terminateChild(nextProcess);

  process.exitCode = signal === 'SIGINT' ? 130 : 143;

  const forceKillTimer = setTimeout(() => {
    forceKillChild(viteProcess);
    forceKillChild(nextProcess);
  }, FORCE_KILL_TIMEOUT_MS);
  forceKillTimer.unref();
};

const watchChildExit = (child: ChildProcess, name: 'next' | 'vite') => {
  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `❌ ${name} exited unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`,
      );
      shutdownAll('SIGTERM');
    }
  });
};

const main = async () => {
  const forwardedSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const sig of forwardedSignals) {
    process.once(sig, () => shutdownAll(sig));
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
    forceKillChild(viteProcess);
    forceKillChild(nextProcess);
  });

  nextProcess = spawn('npx', ['next', 'dev', '-p', String(NEXT_PORT)], {
    detached: !isWindows,
    env: process.env,
    stdio: 'inherit',
    shell: isWindows,
  });
  watchChildExit(nextProcess, 'next');

  viteProcess = runNpmScript('dev:spa');
  watchChildExit(viteProcess, 'vite');
  runNextBackgroundTasks();

  await Promise.race([
    new Promise((resolve) => nextProcess?.once('exit', resolve)),
    new Promise((resolve) => viteProcess?.once('exit', resolve)),
  ]);
};

void main().catch((error) => {
  console.error('❌ dev startup sequence failed:', error);
  shutdownAll('SIGTERM');
});
