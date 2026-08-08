import { spawn as nodeSpawn } from 'node:child_process';
import {
  existsSync as nodeExistsSync,
  statSync as nodeStatSync,
  watch as nodeWatch,
} from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const defaultCheckPort = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });

export function createDevOrchestrator({
  desktopRoot,
  electronBin,
  viteBin,
  vitePort,
  electronArgs = [],
  nodeBin = process.execPath,
  pollIntervalMs = 200,
  bundleQuietMs = 1000,
  initialBuildTimeoutMs = 120_000,
  restartDebounceMs = 400,
  spawn = nodeSpawn,
  existsSync = nodeExistsSync,
  statSync = nodeStatSync,
  watch = nodeWatch,
  checkPort = defaultCheckPort,
  exit = (code) => process.exit(code),
  log = console.log,
  logError = console.error,
}) {
  const MAIN_BUNDLE = path.join(desktopRoot, 'dist/main/index.js');
  const PRELOAD_BUNDLE = path.join(desktopRoot, 'dist/preload/index.js');

  const children = [];
  let electron = null;
  let restarting = false;
  let shuttingDown = false;
  let poll = null;
  let debounce = null;

  // Spawn vite through the current node binary instead of a `pnpm` shim:
  // on Windows the shim is `pnpm.cmd`, which a shell-less spawn cannot start.
  const spawnVite = (args) =>
    spawn(nodeBin, [viteBin, ...args], { cwd: desktopRoot, stdio: 'inherit' });

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(poll);
    clearTimeout(debounce);
    electron?.kill();
    for (const child of children) child.kill();
    exit(code);
  }

  function startElectron() {
    // Automation scripts (e.g. record-electron-demo.sh) grep the log for
    // "starting electron" as the readiness signal — keep this line stable.
    log('[desktop-dev] starting electron');
    electron = spawn(electronBin, ['.', ...electronArgs], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: `http://127.0.0.1:${vitePort}`,
        NODE_ENV: 'development',
      },
      stdio: 'inherit',
    });
    electron.on('exit', (code) => {
      if (shuttingDown) return;
      if (restarting) {
        restarting = false;
        startElectron();
        return;
      }
      // The app was quit by hand — stop the watchers instead of idling forever.
      log('[desktop-dev] electron exited, stopping dev watchers');
      shutdown(code ?? 0);
    });
  }

  function scheduleRestart() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (shuttingDown || !electron) return;
      log('[desktop-dev] main/preload bundle changed, restarting electron');
      restarting = true;
      electron.kill();
    }, restartDebounceMs);
  }

  function watchBundles() {
    for (const dir of [path.dirname(MAIN_BUNDLE), path.dirname(PRELOAD_BUNDLE)]) {
      watch(dir, scheduleRestart);
    }
  }

  function start() {
    children.push(
      spawnVite(['--config', 'vite.renderer.config.ts']),
      spawnVite(['build', '--watch', '--mode', 'development', '--config', 'vite.main.config.ts']),
      spawnVite([
        'build',
        '--watch',
        '--mode',
        'development',
        '--config',
        'vite.preload.config.ts',
      ]),
    );

    for (const child of children) {
      child.on('exit', (code) => {
        if (!shuttingDown) shutdown(code ?? 1);
      });
    }

    // The two build configs `emptyOutDir` on startup and finish at different times,
    // so wait until the renderer server accepts connections and both bundles exist
    // and have been quiet for a second before launching electron or attaching watchers.
    const started = Date.now();
    let lastChange = Date.now();
    let lastSignature = '';
    let checking = false;
    poll = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        if (Date.now() - started > initialBuildTimeoutMs) {
          logError(
            `[desktop-dev] initial build did not produce bundles within ${Math.round(initialBuildTimeoutMs / 1000)}s`,
          );
          shutdown(1);
          return;
        }
        if (!existsSync(MAIN_BUNDLE) || !existsSync(PRELOAD_BUNDLE)) return;
        const signature = [MAIN_BUNDLE, PRELOAD_BUNDLE].map((f) => statSync(f).mtimeMs).join(':');
        if (signature !== lastSignature) {
          lastSignature = signature;
          lastChange = Date.now();
          return;
        }
        if (Date.now() - lastChange < bundleQuietMs) return;
        if (!(await checkPort(vitePort))) return;
        clearInterval(poll);
        watchBundles();
        startElectron();
      } finally {
        checking = false;
      }
    }, pollIntervalMs);
  }

  return { shutdown, start };
}
