import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import net from 'node:net';

import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';

import type { DevTopology } from './devTopology';
import devTopology from './devTopology';

const { applyDefaultDevTopologyEnv, resolveDevAPIPort, resolveDevHonoPort } = devTopology;

const env = process.env.NODE_ENV || 'development';

const shellEnv = Object.entries(process.env).reduce<Record<string, string>>((acc, [key, value]) => {
  if (typeof value === 'string') acc[key] = value;
  return acc;
}, {});
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

const API_HOST = 'localhost';

/**
 * Resolve the local API dev port.
 * Priority: -p CLI flag > PORT env var > 3010.
 */
const resolveCLIAPIPort = (): number | undefined => {
  const pIndex = process.argv.indexOf('-p');
  if (pIndex !== -1 && process.argv[pIndex + 1]) {
    return Number(process.argv[pIndex + 1]);
  }
};

const cliAPIPort = resolveCLIAPIPort();
if (cliAPIPort) process.env.PORT = String(cliAPIPort);

const devTopologyConfig = applyDefaultDevTopologyEnv(process.env);
process.title = `lobe-dev-${devTopologyConfig.topology}`;

const API_PORT = resolveDevAPIPort(process.env);
const API_ROOT_URL = `http://${API_HOST}:${API_PORT}/`;
const HONO_PORT = resolveDevHonoPort(process.env);
const HONO_ROOT_URL = `http://${API_HOST}:${HONO_PORT}/`;
const API_READY_TIMEOUT_MS = 180_000;
const API_READY_RETRY_MS = 400;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let apiProcess: ChildProcess | undefined;
let honoProcess: ChildProcess | undefined;
let viteProcess: ChildProcess | undefined;
let shuttingDown = false;

const runNpmScript = (scriptName: string) =>
  spawn(npmCommand, ['run', scriptName], {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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

const waitForAPIRuntimeReady = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < API_READY_TIMEOUT_MS) {
    if (await isPortOpen(API_HOST, API_PORT)) return;
    await wait(API_READY_RETRY_MS);
  }

  throw new Error(
    `API runtime was not ready within ${API_READY_TIMEOUT_MS / 1000}s on ${API_HOST}:${API_PORT}`,
  );
};

const waitForHonoRuntimeReady = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < API_READY_TIMEOUT_MS) {
    if (await isPortOpen(API_HOST, HONO_PORT)) return;
    await wait(API_READY_RETRY_MS);
  }

  throw new Error(
    `Hono runtime was not ready within ${API_READY_TIMEOUT_MS / 1000}s on ${API_HOST}:${HONO_PORT}`,
  );
};

const prewarmNextRootCompile = async () => {
  const startedAt = Date.now();
  const response = await fetch(API_ROOT_URL, { signal: AbortSignal.timeout(120_000) });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(
    `✅ Next prewarm request finished (${response.status}) in ${elapsed}s ${API_ROOT_URL}`,
  );
};

const runRuntimeBackgroundTasks = (topology: DevTopology) => {
  setTimeout(() => {
    if (devTopologyConfig.apiRuntime !== 'none') {
      console.log(`🔁 API runtime (${topology}) URL: ${API_ROOT_URL}`);
    }
    if (devTopologyConfig.honoRuntime === 'standalone') {
      console.log(`🔁 Hono runtime URL: ${HONO_ROOT_URL}`);
    }
    console.log(`🔁 Browser APP_URL: ${process.env.APP_URL}`);
  }, 2_000);

  void (async () => {
    try {
      if (devTopologyConfig.apiRuntime !== 'none') {
        await waitForAPIRuntimeReady();
        await prewarmNextRootCompile();
        return;
      }

      if (devTopologyConfig.honoRuntime === 'standalone') await waitForHonoRuntimeReady();
    } catch (error) {
      console.warn('⚠️ Runtime readiness check skipped:', error);
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
  terminateChild(apiProcess);
  terminateChild(honoProcess);

  process.exitCode = signal === 'SIGINT' ? 130 : 143;
};

const watchChildExit = (child: ChildProcess, name: string) => {
  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `❌ ${name} exited unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`,
      );
      shutdownAll('SIGTERM');
    }
  });
};

const startAPIRuntime = () => {
  if (devTopologyConfig.apiRuntime === 'none') return;

  const bundlerArgs = devTopologyConfig.nextBundler === 'webpack' ? ['--webpack'] : [];

  return spawn('npx', ['next', 'dev', ...bundlerArgs, '-p', String(API_PORT)], {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
};

const startHonoRuntime = () => {
  if (devTopologyConfig.honoRuntime !== 'standalone') return;

  return spawn(
    'npx',
    [
      'vite-node',
      '--watch',
      '--config',
      'scripts/viteNodeServer.config.ts',
      'src/server/hono/standalone.ts',
    ],
    {
      env: {
        ...process.env,
        HONO_PORT: String(HONO_PORT),
        PORT: String(HONO_PORT),
      },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );
};

const main = async () => {
  process.once('SIGINT', () => shutdownAll('SIGINT'));
  process.once('SIGTERM', () => shutdownAll('SIGTERM'));

  console.log(`🔧 Dev topology: ${devTopologyConfig.topology}`);
  console.log(`🔧 API target: ${devTopologyConfig.apiTarget}`);
  if (devTopologyConfig.honoTarget) console.log(`🔧 Hono target: ${devTopologyConfig.honoTarget}`);

  honoProcess = startHonoRuntime();
  if (honoProcess) watchChildExit(honoProcess, 'hono');

  apiProcess = startAPIRuntime();
  if (apiProcess) watchChildExit(apiProcess, devTopologyConfig.apiRuntime);

  viteProcess = runNpmScript('dev:spa');
  watchChildExit(viteProcess, 'vite');
  if (apiProcess || honoProcess) runRuntimeBackgroundTasks(devTopologyConfig.topology);

  await Promise.race([
    new Promise((resolve) => honoProcess?.once('exit', resolve)),
    new Promise((resolve) => apiProcess?.once('exit', resolve)),
    new Promise((resolve) => viteProcess?.once('exit', resolve)),
  ]);
};

void main().catch((error) => {
  console.error('❌ dev startup sequence failed:', error);
  shutdownAll('SIGTERM');
});
