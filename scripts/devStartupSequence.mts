import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import net from 'node:net';

const NEXT_HOST = 'localhost';

/**
 * Parse the Next.js dev port from the `dev:next` script in the nearest package.json.
 * Supports both `--port <n>` and `-p <n>` flags. Falls back to 3010.
 */
const resolveNextPort = (): number => {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
    const devNext: string | undefined = pkg?.scripts?.['dev:next'];
    if (devNext) {
      const match = devNext.match(/(?:--port|-p)\s+(\d+)/);
      if (match) return Number(match[1]);
    }
  } catch { /* fallback */ }
  return 3010;
};

const NEXT_PORT = resolveNextPort();
const NEXT_ROOT_URL = `http://${NEXT_HOST}:${NEXT_PORT}/`;
const NEXT_READY_TIMEOUT_MS = 180_000;
const NEXT_READY_RETRY_MS = 400;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let nextProcess: ChildProcess | undefined;
let viteProcess: ChildProcess | undefined;
let shuttingDown = false;

const runNpmScript = (scriptName: string) =>
  spawn(npmCommand, ['run', scriptName], {
    env: process.env,
    stdio: 'inherit',
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
  const response = await fetch(NEXT_ROOT_URL, { signal: AbortSignal.timeout(120_000) });
  console.log(`✅ Next prewarm request finished (${response.status}) ${NEXT_ROOT_URL}`);
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

const terminateChild = (child?: ChildProcess) => {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
};

const shutdownAll = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;

  terminateChild(viteProcess);
  terminateChild(nextProcess);

  process.exitCode = signal === 'SIGINT' ? 130 : 143;
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
  process.once('SIGINT', () => shutdownAll('SIGINT'));
  process.once('SIGTERM', () => shutdownAll('SIGTERM'));

  nextProcess = runNpmScript('dev:next');
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
