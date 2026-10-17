#!/usr/bin/env node
// Builds, runs and cleans up a throwaway probe app for macOS privacy-permission
// experiments. See ./README.md for why every step is here.
//
//   node probe.mjs build             # build + sign the probe app
//   node probe.mjs start [--probe]   # launch it (--probe: no prompt, no capture)
//   node probe.mjs log               # tail the result log
//   node probe.mjs cleanup           # remove the app AND its TCC entry
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ELECTRON_APP = path.join(REPO_ROOT, 'apps/desktop/node_modules/electron/dist/Electron.app');
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

const APP_PATH =
  process.env.PROBE_APP ?? path.join(os.homedir(), 'Applications', 'PermissionProbe.app');
const BUNDLE_ID = process.env.PROBE_BUNDLE_ID ?? 'com.lobehub.permission-probe';
const LOG_PATH = process.env.PROBE_LOG ?? '/tmp/lobe-permission-probe.log';
const PID_PATH = `${LOG_PATH}.pid`;
const SERVICE = 'ScreenCapture';

const run = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A helper the README suggests for watching for system dialogs. It keeps the
// full-resolution frame AND a downscaled copy: the dialog text is unreadable
// after a downscale, so the original must survive.
const watchShots = () => {
  const dir = process.env.PROBE_SHOTS ?? path.join(os.tmpdir(), 'probe-shots');
  fs.mkdirSync(dir, { recursive: true });
  console.log(`watching into ${dir} (full-res + -small copy) — kill this process to stop`);
  for (;;) {
    const stamp = Math.floor(Date.now() / 1000);
    try {
      execFileSync('screencapture', ['-x', path.join(dir, `s-${stamp}.png`)]);
      execFileSync('sips', [
        '-Z',
        '1500',
        path.join(dir, `s-${stamp}.png`),
        '--out',
        path.join(dir, `s-${stamp}-small.png`),
      ]);
    } catch {
      /* a transient capture failure is not fatal */
    }
    execFileSync('sleep', ['3']);
  }
};
const signingIdentity = () => {
  if (process.env.PROBE_IDENTITY) return process.env.PROBE_IDENTITY;
  const found = run('security', ['find-identity', '-v', '-p', 'codesigning'])
    .split('\n')
    .find((line) => line.includes('Developer ID Application'));
  if (!found) throw new Error('no "Developer ID Application" identity; pass PROBE_IDENTITY=…');
  return found.split('"')[1];
};

const entitlementsPath = () => {
  const file = path.join(os.tmpdir(), 'lobe-probe-entitlements.plist');
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>`,
  );
  return file;
};

// A plain `--deep` ad-hoc re-sign of Electron produces a bundle whose signature
// verifies but which macOS refuses as a TCC client: tccd answers `unknown`,
// ScreenCaptureKit refuses, and System Settings will not let the user add it.
// Developer ID + hardened runtime makes it a real client; disable-library-
// validation is what lets the hardened process load Electron's nested libs.
const build = () => {
  if (process.platform !== 'darwin') throw new Error('macOS only');
  const plist = '/usr/libexec/PlistBuddy';
  fs.rmSync(APP_PATH, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(APP_PATH), { recursive: true });
  run('ditto', [ELECTRON_APP, APP_PATH]);
  for (const [key, value] of [
    ['CFBundleIdentifier', BUNDLE_ID],
    ['CFBundleName', 'PermissionProbe'],
    ['CFBundleDisplayName', 'PermissionProbe'],
  ]) {
    run(plist, ['-c', `Set :${key} ${value}`, path.join(APP_PATH, 'Contents/Info.plist')]);
  }

  const appDir = path.join(APP_PATH, 'Contents/Resources/app');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ main: 'main.js', name: 'permission-probe', version: '1.0.0' }),
  );
  fs.copyFileSync(path.join(HERE, 'main.js'), path.join(appDir, 'main.js'));
  fs.writeFileSync(
    path.join(appDir, 'probe.config.json'),
    `${JSON.stringify({ logPath: LOG_PATH, mode: 'capture', pidPath: PID_PATH, repoRoot: REPO_ROOT }, null, 2)}\n`,
  );

  run('codesign', [
    '--force',
    '--deep',
    '--timestamp=none',
    '--options',
    'runtime',
    '--entitlements',
    entitlementsPath(),
    '--sign',
    signingIdentity(),
    APP_PATH,
  ]);
  run('codesign', ['--verify', '--strict', APP_PATH]);
  // LaunchServices must know the bundle before `tccutil reset` can resolve it.
  run(LSREGISTER, ['-f', APP_PATH]);
  console.log(`built ${APP_PATH}\n  bundle id: ${BUNDLE_ID}\n  log:       ${LOG_PATH}`);
};

const start = (argv) => {
  const guide = argv.includes('--guide');
  const mode = guide
    ? 'guide'
    : argv.includes('--passive')
      ? 'passive'
      : argv.includes('--probe')
        ? 'probe'
        : 'capture';
  const passthrough = argv.filter((flag) =>
    ['--no-request', '--only-legacy', '--only-sck'].includes(flag),
  );
  const appArgs = [...(mode === 'capture' ? [] : [`--${mode}`]), ...passthrough];
  fs.rmSync(LOG_PATH, { force: true });
  // `open` keeps the app its own TCC responsible process; a shell-launched
  // process can inherit the terminal's grant instead. It also does not forward
  // the environment, hence `--args`.
  execFileSync('open', appArgs.length > 0 ? [APP_PATH, '--args', ...appArgs] : [APP_PATH]);
  console.log(`launched ${APP_PATH} (mode: ${mode}${appArgs.length > 0 ? `, ${appArgs.join(' ')}` : ''})`);
  console.log(`watch: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} log`);
};

const cleanup = () => {
  // Quit first: deleting the bundle out from under a running app leaves its
  // helper processes orphaned.
  try {
    execFileSync('pkill', ['-f', `${APP_PATH}/Contents/MacOS`]);
  } catch {
    /* not running */
  }
  // Reset while the bundle still exists: once it is deleted the bundle id no
  // longer resolves and `tccutil reset` fails with -10814, leaving the entry
  // behind for good (a stub bundle does not work either).
  try {
    console.log(run('tccutil', ['reset', SERVICE, BUNDLE_ID]).trim());
  } catch (error) {
    console.log(`tccutil reset skipped: ${error.message.split('\n')[0]}`);
  }
  try {
    run(LSREGISTER, ['-u', APP_PATH]);
  } catch {
    /* not registered */
  }
  fs.rmSync(APP_PATH, { force: true, recursive: true });
  console.log(`removed ${APP_PATH}`);
};

const [, , command = 'help', ...rest] = process.argv;
const commands = {
  build,
  cleanup,
  help: () => console.log(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8')),
  log: () => {
    if (!fs.existsSync(LOG_PATH)) throw new Error(`no log yet at ${LOG_PATH}`);
    console.log(fs.readFileSync(LOG_PATH, 'utf8'));
  },
  start: () => start(rest),
  'watch-shots': watchShots,
};

if (!commands[command])
  throw new Error(`unknown command ${command}; try build | start | log | cleanup`);
commands[command]();
