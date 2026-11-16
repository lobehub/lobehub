import { spawn as nodeSpawn } from 'node:child_process';
import {
  existsSync as nodeExistsSync,
  rmSync as nodeRmSync,
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
  electronQuitTimeoutMs = 10_000,
  spawn = nodeSpawn,
  existsSync = nodeExistsSync,
  rmSync = nodeRmSync,
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
  let electronRunning = false;
  let restarting = false;
  let shuttingDown = false;
  let poll = null;
  let debounce = null;

  // Spawn vite through the current node binary instead of a `pnpm` shim:
  // on Windows the shim is `pnpm.cmd`, which a shell-less spawn cannot start.
  const spawnVite = (args) =>
    spawn(nodeBin, [viteBin, ...args], { cwd: desktopRoot, stdio: 'inherit' });

  /**
   * Waits for Electron to finish its own quit (`app.quit()` on SIGTERM) before
   * exiting: a launcher that exits first lets the runtime supervisor kill the
   * app mid-shutdown, losing its last log lines and the clean-exit stamp in
   * `<userData>/logs/manifest.json`. A quit that hangs is killed after the timeout.
   */
  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(poll);
    clearTimeout(debounce);
    for (const child of children) child.kill();
    if (!electron || !electronRunning) {
      exit(code);
      return;
    }
    const app = electron;
    const forceKill = setTimeout(() => {
      logError(`[desktop-dev] electron did not quit within ${electronQuitTimeoutMs}ms, killing it`);
      app.kill('SIGKILL');
      exit(code);
    }, electronQuitTimeoutMs);
    app.once('exit', (exitCode, signal) => {
      clearTimeout(forceKill);
      log(`[desktop-dev] electron quit (code ${exitCode}, signal ${signal})`);
      exit(code);
    });
    app.kill();
  }

  function startElectron() {
    // Automation scripts (e.g. record-electron-demo.sh) grep the log for
    // "starting electron" as the readiness signal — keep this line stable.
    log('[desktop-dev] starting electron');
    electron = spawn(electronBin, ['.', ...electronArgs], {
      cwd: desktopRoot,
      // Own process group: Chromium handles only the first SIGTERM/SIGINT gracefully
      // and resets the handler, so a group signal (Ctrl+C, `dev down`) plus the
      // `shutdown()` kill would hard-kill Electron mid-quit. Detached, it receives
      // exactly one signal, from `shutdown()`. Windows has no signals and would
      // open a new console window for a detached child.
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: `http://127.0.0.1:${vitePort}`,
        NODE_ENV: 'development',
      },
      stdio: 'inherit',
    });
    electronRunning = true;
    electron.on('exit', (code) => {
      electronRunning = false;
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

  const pendingChanges = new Map();

  function scheduleRestart(dir, eventType, filename) {
    const file = path.join(dir, filename ?? '');
    const detail = existsSync(file)
      ? `${statSync(file).size}B @${new Date(statSync(file).mtimeMs).toISOString()}`
      : 'missing';
    pendingChanges.set(path.relative(desktopRoot, file), `${eventType} ${detail}`);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const changes = [...pendingChanges].map(([f, d]) => `  ${f}: ${d}`).join('\n');
      pendingChanges.clear();
      if (shuttingDown || !electron) return;
      log(`[desktop-dev] main/preload bundle changed, restarting electron\n${changes}`);
      restarting = true;
      electron.kill();
    }, restartDebounceMs);
  }

  function watchBundles() {
    for (const dir of [path.dirname(MAIN_BUNDLE), path.dirname(PRELOAD_BUNDLE)]) {
      watch(dir, (eventType, filename) => scheduleRestart(dir, eventType, filename));
    }
  }

  function start() {
    rmSync(path.join(desktopRoot, 'dist'), { force: true, recursive: true });
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
    // Bundles left over from a previous run look "quiet" too, so ignore anything
    // written before this run started — otherwise electron boots on the stale dist
    // right as the watch build empties it.
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
        const mtimes = [MAIN_BUNDLE, PRELOAD_BUNDLE].map((f) => statSync(f).mtimeMs);
        if (mtimes.some((mtime) => mtime < started)) return;
        const signature = mtimes.join(':');
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
