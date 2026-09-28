const path = require('node:path');
const { app } = require('electron');

const DOWNLOAD_URL = 'https://lobehub.com/downloads';

// resolveCore counts every launch as a boot attempt; a secondary instance exits without ever
// marking the core healthy, so it must leave before touching OTA state. Packaged only: dev
// moves userData in pre-app-init, and the lock is keyed by that dir.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  console.info('[shell] Another instance is already running, exiting');
  app.exit(0);
  return;
}

const lastResort = (error) => {
  console.error('[shell] rescue unavailable', error);
  try {
    const { dialog, shell } = require('electron');
    app
      .whenReady()
      .then(() => {
        dialog.showErrorBox(
          'LobeHub',
          `LobeHub failed to start. Please download and reinstall the latest version.\n\n${DOWNLOAD_URL}`,
        );
        return shell.openExternal(DOWNLOAD_URL);
      })
      .catch(() => {})
      .finally(() => app.exit(1));
  } catch {
    app.exit(1);
  }
};

// Every path that ends without a running core lands here: the full-package updater lives in the
// core, so without this a broken builtin core would leave the user no way to update but reinstall.
const rescue = (error, log) => {
  if (!app.isPackaged) throw error;
  try {
    require('./rescue').runRescue({ downloadUrl: DOWNLOAD_URL, error, fallback: lastResort, log });
  } catch (rescueError) {
    lastResort(rescueError);
  }
};

let core;
try {
  const { installShellResolver, resolveCore } = require('./core-loader');

  const builtinDir = app.isPackaged
    ? path.join(process.resourcesPath, 'core')
    : path.join(__dirname, '..');

  const loadAbi = () => {
    try {
      return require('./abi.json');
    } catch (error) {
      if (app.isPackaged) throw error;
      return { publicKey: '', shellAbi: 'dev', shellVersion: app.getVersion() };
    }
  };

  const abi = loadAbi();

  core = app.isPackaged
    ? resolveCore({
        abi: abi.shellAbi,
        builtinDir,
        publicKey: abi.publicKey,
        userData: app.getPath('userData'),
      })
    : {
        dir: builtinDir,
        log: [],
        manifest: null,
        markBroken() {},
        markHealthy() {},
        source: 'builtin',
      };

  if (app.isPackaged) installShellResolver(path.join(__dirname, '..', 'node_modules'));

  global.__SHELL__ = {
    abi: abi.shellAbi,
    builtinDir,
    coreDir: core.dir,
    log: core.log,
    manifest: core.manifest,
    markHealthy: core.markHealthy ?? (() => {}),
    publicKey: abi.publicKey,
    shellVersion: abi.shellVersion,
    source: core.source,
  };
} catch (error) {
  rescue(error, core?.log);
  return;
}

if (core.source === 'rescue') {
  rescue(new Error('builtin core failed to boot repeatedly'), core.log);
  return;
}

try {
  require(path.join(core.dir, 'dist', 'main', 'index.js'));
} catch (error) {
  core.markBroken();
  // A half-evaluated core may already own ipcMain handlers and app listeners, so the next
  // candidate gets a fresh process instead of a second require here.
  if (core.source === 'external') {
    console.error('[shell] external core threw during load, relaunching', error);
    app.relaunch();
    app.exit(1);
    return;
  }
  rescue(error, core.log);
}
