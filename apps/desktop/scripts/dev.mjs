import { spawn } from 'node:child_process';
import { existsSync, statSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(desktopRoot, 'package.json'));
const electronBin = require('electron');

const VITE_PORT = Number(process.env.LOBE_DESKTOP_VITE_PORT) || 5173;
const MAIN_BUNDLE = path.join(desktopRoot, 'dist/main/index.js');
const PRELOAD_BUNDLE = path.join(desktopRoot, 'dist/preload/index.js');

let electron = null;
let restarting = false;
let shuttingDown = false;

const spawnVite = (args) =>
  spawn('pnpm', ['exec', 'vite', ...args], { cwd: desktopRoot, stdio: 'inherit' });

const children = [
  spawnVite(['--config', 'vite.renderer.config.ts']),
  spawnVite(['build', '--watch', '--mode', 'development', '--config', 'vite.main.config.ts']),
  spawnVite(['build', '--watch', '--mode', 'development', '--config', 'vite.preload.config.ts']),
];

for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  electron?.kill();
  for (const child of children) child.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function startElectron() {
  electron = spawn(electronBin, ['.'], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: `http://127.0.0.1:${VITE_PORT}`,
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
    console.log('[desktop-dev] electron exited, stopping dev watchers');
    shutdown(code ?? 0);
  });
}

let debounce = null;
function scheduleRestart() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    if (shuttingDown || !electron) return;
    console.log('[desktop-dev] main/preload bundle changed, restarting electron');
    restarting = true;
    electron.kill();
  }, 400);
}

function watchBundles() {
  for (const dir of [path.dirname(MAIN_BUNDLE), path.dirname(PRELOAD_BUNDLE)]) {
    watch(dir, scheduleRestart);
  }
}

const rendererServerReady = () =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: VITE_PORT }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });

// The two build configs `emptyOutDir` on startup and finish at different times,
// so wait until the renderer server accepts connections and both bundles exist
// and have been quiet for a second before launching electron or attaching watchers.
const started = Date.now();
let lastChange = Date.now();
let lastSignature = '';
let checking = false;
const poll = setInterval(async () => {
  if (checking) return;
  checking = true;
  try {
    if (Date.now() - started > 120_000) {
      console.error('[desktop-dev] initial build did not produce bundles within 120s');
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
    if (Date.now() - lastChange < 1000) return;
    if (!(await rendererServerReady())) return;
    clearInterval(poll);
    watchBundles();
    startElectron();
  } finally {
    checking = false;
  }
}, 200);
