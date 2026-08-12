import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the relocated helper lives. Under `ProgramData` because its default ACL
 * grants `BUILTIN\Users` read+execute — which is the entire point.
 */
const stagingRoot = (): string =>
  path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'LobeHub', 'sandbox');

const ARCH_DIR: Partial<Record<string, string>> = { arm64: 'arm64', x64: 'x64' };

/**
 * Locate the helper binary shipped with this app.
 *
 * The backend's own `getSrtWinPath()` resolves relative to its package
 * directory, which stops being true the moment its JavaScript is bundled into
 * the main process — the computed path then points inside the bundle rather
 * than at any real file. A packaged app therefore has to be told where its own
 * resources are, and the desktop ships the binaries under
 * `resources/sandbox-runtime/vendor`.
 *
 * Ordered most- to least-explicit; `process.resourcesPath` is undefined outside
 * a packaged Electron app, so development and tests fall through to the
 * backend's own lookup.
 */
export const resolveSrtWinSource = (packagedFallback?: () => string): string | undefined => {
  const fromEnv = process.env.LOBE_SRT_WIN_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  const arch = ARCH_DIR[process.arch];
  if (resourcesPath && arch) {
    const packaged = path.join(
      resourcesPath,
      'sandbox-runtime',
      'vendor',
      'srt-win',
      arch,
      'srt-win.exe',
    );
    if (fs.existsSync(packaged)) return packaged;
  }

  try {
    return packagedFallback?.();
  } catch {
    return undefined;
  }
};

/**
 * Version the staged copy so an app update cannot leave a stale helper behind:
 * a newer runtime gets a new directory rather than silently reusing the old
 * binary. Read from the package that owns the binary, so it tracks the real
 * artifact instead of anything we'd have to remember to bump.
 */
const resolveVersion = (packagedExe: string): string => {
  // <pkgRoot>/vendor/srt-win/<arch>/srt-win.exe
  const pkgRoot = path.resolve(path.dirname(packagedExe), '../../..');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version;
  } catch {
    // fall through
  }
  // Size is a weak but honest fallback: it changes with the binary, and a
  // collision only costs us a re-check that the copy already matches.
  return `size-${fs.statSync(packagedExe).size}`;
};

/**
 * Copy the Windows sandbox helper somewhere the sandbox user can actually read,
 * and return that path.
 *
 * The sandbox runs the child as a *separate local account*, so every binary in
 * the launch chain must be readable by that account — not just by the person
 * running the app. The desktop app installs per-user by default, landing the
 * packaged helper under `C:\Users\<name>\AppData\Local\…`, a tree no other
 * local account may read. `CreateProcessWithLogonW` then logs the sandbox user
 * on successfully and fails at process creation with a bare ACCESS_DENIED,
 * which reads like a broken sandbox rather than a file-permission problem.
 * Confirmed on a real host: same binary, same machine, works from
 * `ProgramData` and fails from the user profile.
 *
 * Relocating is the supported fix — the backend takes a `windows.srtWin.path`
 * override precisely so embedders can place the helper themselves. Granting the
 * sandbox account an ACE on the install directory would work too, but a
 * per-user install directory is replaced wholesale on update, taking the ACE
 * with it and silently breaking the sandbox again.
 *
 * Returns `undefined` on anything other than Windows (nothing to relocate) and
 * whenever staging fails — callers then fall back to the packaged binary, which
 * is the current behaviour, not a regression.
 */
export const ensureStagedSrtWin = (packagedExe: string): string | undefined => {
  if (process.platform !== 'win32') return undefined;

  try {
    const target = path.join(
      stagingRoot(),
      `srt-win-${resolveVersion(packagedExe)}`,
      'srt-win.exe',
    );

    // Size match is enough to treat the copy as current: the directory is
    // already version-scoped, so this only guards a truncated or half-written
    // file from a previous interrupted copy.
    const source = fs.statSync(packagedExe);
    if (fs.existsSync(target) && fs.statSync(target).size === source.size) return target;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Copy via a temp name in the same directory so a concurrent launch never
    // observes a partially written executable.
    const pending = `${target}.${process.pid}.tmp`;
    fs.copyFileSync(packagedExe, pending);
    fs.renameSync(pending, target);
    return target;
  } catch {
    // Another user on this machine may own the staged copy, ProgramData may be
    // locked down, the disk may be full. None of that should take the whole
    // feature down — fall back and let the caller fail loudly at launch if the
    // packaged path really is unreachable.
    return undefined;
  }
};

/**
 * The helper path every caller must use — the probe, the launch, and setup.
 *
 * Resolution and staging are combined here on purpose. When they were separate,
 * the probe fell back to the unstaged source while the launch fell back to *no
 * override at all*, letting the backend resolve its own package-relative path —
 * which is inside `app.asar` once bundled. A host where staging fails
 * (ProgramData locked down, disk full) would then be advertised as available and
 * fail on the first command. One function, one answer.
 *
 * Falling back to the unstaged source rather than giving up is deliberate: a
 * per-machine install already lives somewhere the sandbox account can read, so
 * staging is an accommodation for per-user installs, not a precondition.
 */
export const resolveEffectiveSrtWin = (packagedFallback?: () => string): string | undefined => {
  const source = resolveSrtWinSource(packagedFallback);
  if (!source) return undefined;
  return ensureStagedSrtWin(source) ?? source;
};
