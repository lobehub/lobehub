// Harness for the Screen Recording "does a mid-life grant need a relaunch"
// experiment. It is built into a properly signed probe app by `probe.mjs`;
// run that instead of this file.
//
// The capture attempts are unconditional, because that is the measurement: no
// status API decides whether the experiment runs. Every attempt prints all four
// signals, so the log shows exactly which one flips first:
//   cg     - CGPreflightScreenCaptureAccess (documented process-lifetime cache)
//   tccd   - the raw tccd query the app uses for the status (uncached)
//   sck    - a real ScreenCaptureKit still
//   legacy - a real node-screenshots still (the API ScreenCaptureKit replaced)
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const { app, screen, shell } = require('electron');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'probe.config.json'), 'utf8'));
const LOG = process.env.PROBE_LOG ?? config.logPath;
// `open` launches through launchd, which does not forward the caller's
// environment, so the mode arrives as an argument.
//
//   capture  ask for the permission, then capture every tick (the original
//            mid-grant experiment)
//   passive  never ask, never touch ScreenCaptureKit before the status flips —
//            the flow the real app uses, so it can answer "does macOS raise its
//            quit-and-reopen dialog when nothing requested the permission?"
//   probe    statuses only: no request, no capture, never raises a prompt
const MODE = process.argv.includes('--guide')
  ? 'passive'
  : process.argv.includes('--passive')
    ? 'passive'
    : process.argv.includes('--probe')
      ? 'probe'
      : (process.env.PROBE_MODE ?? config.mode);
const CAPTURES = MODE !== 'probe';
// `--no-request` keeps the request API out so a dialog can be attributed to the
// capture calls alone; `--only-sck` / `--only-legacy` then separate the two
// capture paths, because only one of them is supposed to prompt on macOS 15+.
const REQUESTS = MODE === 'capture' && !process.argv.includes('--no-request');
const ONLY = process.argv.includes('--only-sck')
  ? 'sck'
  : process.argv.includes('--only-legacy')
    ? 'legacy'
    : 'both';
// `--guide` puts the real NSPanel from @lobechat/electron-mac-permission-guide
// on screen, so the app is dragged into the pane exactly the way the product
// does it — and its events (notably `promptShown`) report whether macOS raised a
// dialog over System Settings.
const GUIDE = process.argv.includes('--guide');

const RUN_MS = 30 * 60 * 1000;
const ATTEMPT_MS = 2000;

// Rotate rather than truncate: a run that spans the grant is exactly the one
// worth keeping when a later launch starts.
if (fs.existsSync(LOG)) fs.renameSync(LOG, `${LOG}.1`);
fs.writeFileSync(LOG, '');
const log = (...parts) => {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${parts.join(' ')}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
};

// Resolve through the desktop app so the workspace links and the
// electron-rebuilt natives are the ones the real app loads.
const desktopRequire = createRequire(path.join(config.repoRoot, 'apps/desktop/package.json'));
const load = (label, specifier) => {
  try {
    return desktopRequire(specifier);
  } catch (error) {
    log(`WARN could not load ${label}: ${error.message}`);
    return null;
  }
};

const macPermissions = load('node-mac-permissions', 'node-mac-permissions');
const guide = load('permission-guide', '@lobechat/electron-mac-permission-guide');
const screenCapture = load('screen-capture', '@lobechat/electron-mac-screen-capture');
const legacy = load('node-screenshots', 'node-screenshots');

const guarded = (fn) => {
  try {
    return fn();
  } catch (error) {
    return `err(${error.message})`;
  }
};

// Only tells uniform from non-uniform. It is NOT a permission signal: the
// legacy path returns wallpaper with the windows omitted while denied.
const uniformity = (raw) => {
  if (!raw || raw.length < 64) return 'no-raw';
  let min = 255;
  let max = 0;
  for (let i = 0; i < raw.length; i += 4093) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max === min ? 'BLANK' : 'content';
};

app.whenReady().then(async () => {
  log(`process up pid=${process.pid} bundle=${app.getName()} mode=${MODE}`);
  fs.writeFileSync(config.pidPath, String(process.pid));
  log(
    `start: cg=${guarded(() => macPermissions.getAuthStatus('screen'))} tccd=${guarded(() => guide.screenCaptureStatus())}`,
  );

  if (REQUESTS) {
    // Creates this bundle's TCC entry so it is listed in the pane, and puts the
    // user in front of the switch they have to flip. Passive mode deliberately
    // skips this: if anything requests the permission, the run says nothing
    // about whether macOS raises its quit-and-reopen dialog for the app flow.
    guarded(() => macPermissions.askForScreenCaptureAccess(true));
  }
  if (MODE !== 'probe') {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  }

  if (GUIDE && guide) {
    // Same state buildGuideState produces for the 'waiting' phase, with the
    // strings from apps/desktop/src/main/locales/default/dialog.ts.
    const executable = app.getPath('exe');
    const bundlePath = executable.slice(0, executable.indexOf('.app/') + 4);
    guide.onGuideEvent((event) => log(`guide event: ${JSON.stringify(event)}`));
    const cursor = screen.getCursorScreenPoint();
    guide.showGuide({
      accessory: 'appIcon',
      appPath: bundlePath,
      bottomInset: 20,
      closeLabel: 'Close',
      draggable: true,
      iconLabel: 'PermissionProbe',
      launchOrigin: cursor,
      missingTimeoutMs: 3000,
      sidebarWidth: 232,
      subtitle: 'Screen Recording · Or turn on its switch',
      title: 'Drag into the list above',
    });
    log(`guide shown for ${bundlePath}; drag the icon into the list`);
  }

  const startedAt = Date.now();
  let attempt = 0;

  const tick = async () => {
    attempt += 1;
    const since = ((Date.now() - startedAt) / 1000).toFixed(0);
    const cg = guarded(() => macPermissions.getAuthStatus('screen'));
    const tccd = guarded(() => guide.screenCaptureStatus());
    // Passive mode waits for the grant before touching ScreenCaptureKit: an
    // early call would raise the system prompt itself and create the very entry
    // this run wants to see created by the pane instead.
    const authorised = cg === 'authorized' || tccd === 'granted';

    let sck = 'skipped';
    if (CAPTURES && ONLY !== 'legacy' && (MODE !== 'passive' || authorised)) {
      const started = Date.now();
      const png = await screenCapture.captureRect({ height: 200, width: 300, x: 60, y: 60 });
      sck = png ? `OK ${png.length}B ${Date.now() - started}ms` : 'null';
      if (png && attempt > 1 && !globalThis.firstSck) {
        globalThis.firstSck = Date.now();
        log(
          `*** ScreenCaptureKit first succeeded at t+${since}s in the process that started before the grant.`,
        );
      }
    }

    let legacyResult = 'skipped';
    if (CAPTURES && legacy && ONLY !== 'sck' && (MODE !== 'passive' || authorised)) {
      const started = Date.now();
      try {
        const image = await legacy.Monitor.all()[0].captureImage();
        legacyResult = `OK ${image.width}x${image.height} ${uniformity(image.toRawSync())} ${Date.now() - started}ms`;
      } catch (error) {
        legacyResult = `FAILED ${error.message}`;
      }
    }

    log(`#${attempt} t+${since}s cg=${cg} tccd=${tccd} sck=${sck} legacy=${legacyResult}`);
  };

  await tick();
  const timer = setInterval(() => {
    void tick();
    if (Date.now() - startedAt > RUN_MS) {
      log('TIMEOUT after 30 minutes.');
      clearInterval(timer);
      app.exit(0);
    }
  }, ATTEMPT_MS);
});
