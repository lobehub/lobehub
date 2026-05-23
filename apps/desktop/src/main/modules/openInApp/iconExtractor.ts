import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { OpenInAppId } from '@lobechat/electron-client-ipc';

import { createLogger } from '@/utils/logger';

import { APP_REGISTRY } from './registry';

const logger = createLogger('modules:openInApp:iconExtractor');

// Manual promise wrapper rather than util.promisify(execFile): the latter
// relies on execFile's custom `util.promisify.custom` symbol to return
// `{ stdout, stderr }`, which vi.fn() mocks don't carry — so destructuring
// silently yields `undefined` under test. This wrapper resolves directly to
// the stdout string and is mock-friendly.
const execFileToString = (
  file: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<string> =>
  new Promise((resolve, reject) => {
    const cb = (err: Error | null, stdout: string, stderr: string) => {
      if (err) {
        (err as Error & { stderr?: string }).stderr = stderr;
        reject(err);
      } else {
        resolve(stdout);
      }
    };
    if (opts) execFile(file, args, opts, cb);
    else execFile(file, args, cb);
  });

/** Render dimensions for the extracted PNG. 64 keeps the payload tiny while
 *  staying crisp at the renderer's 16-20 px display size on retina. */
const ICON_SIZE = 64;

/** Per-extraction bound. plutil and sips are local file ops; tens of ms is
 *  typical, so a generous timeout still catches real hangs. */
const EXEC_TIMEOUT_MS = 5000;

let tmpDirPromise: Promise<string | undefined> | undefined;

const ensureTmpDir = async (): Promise<string | undefined> => {
  if (tmpDirPromise) return tmpDirPromise;
  tmpDirPromise = (async () => {
    try {
      return await mkdtemp(path.join(tmpdir(), 'lobehub-openinapp-'));
    } catch (error) {
      logger.debug(`failed to create tmp dir: ${(error as Error).message}`);
      return undefined;
    }
  })();
  return tmpDirPromise;
};

let toolsAvailablePromise: Promise<boolean> | undefined;

/**
 * Confirm `plutil` and `sips` are both on PATH. Both ship with every macOS
 * install so this is effectively a sanity check; cached for the process lifetime.
 */
const areToolsAvailable = (): Promise<boolean> => {
  if (toolsAvailablePromise) return toolsAvailablePromise;
  toolsAvailablePromise = (async () => {
    try {
      await execFileToString('/usr/bin/which', ['plutil']);
      await execFileToString('/usr/bin/which', ['sips']);
      return true;
    } catch {
      logger.debug('plutil or sips missing from PATH; falling back to renderer icons');
      return false;
    }
  })();
  return toolsAvailablePromise;
};

const resolveDarwinBundlePath = async (id: OpenInAppId): Promise<string | undefined> => {
  const strategy = APP_REGISTRY[id]?.detect.darwin;
  if (!strategy || strategy.type !== 'appBundle') return undefined;
  for (const candidate of strategy.paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
};

/**
 * Look up the bundle's icon file name via Info.plist (`CFBundleIconFile`).
 * Returns the resolved absolute .icns path, or undefined if not derivable.
 */
const resolveIcnsPath = async (bundlePath: string): Promise<string | undefined> => {
  const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
  try {
    const stdout = await execFileToString(
      'plutil',
      ['-extract', 'CFBundleIconFile', 'raw', plistPath],
      { timeout: EXEC_TIMEOUT_MS },
    );
    const iconName = stdout.trim();
    if (!iconName) return undefined;
    const fileName = iconName.endsWith('.icns') ? iconName : `${iconName}.icns`;
    const icnsPath = path.join(bundlePath, 'Contents', 'Resources', fileName);
    await access(icnsPath);
    return icnsPath;
  } catch (error) {
    logger.debug(`resolveIcnsPath failed for ${bundlePath}: ${(error as Error).message}`);
    return undefined;
  }
};

/**
 * Resize/convert the given .icns to a 64×64 PNG using sips, then return the
 * base64 data URL. The PNG file is unlinked after read.
 */
const renderIcnsToDataUrl = async (
  icnsPath: string,
  tmpDir: string,
  filename: string,
): Promise<string | undefined> => {
  const outPath = path.join(tmpDir, filename);
  try {
    await execFileToString(
      'sips',
      [
        '-z',
        String(ICON_SIZE),
        String(ICON_SIZE),
        '-s',
        'format',
        'png',
        icnsPath,
        '--out',
        outPath,
      ],
      { timeout: EXEC_TIMEOUT_MS },
    );
    const buf = await readFile(outPath);
    if (buf.length === 0) return undefined;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (error) {
    logger.debug(`sips failed for ${icnsPath}: ${(error as Error).message}`);
    return undefined;
  } finally {
    unlink(outPath).catch(() => undefined);
  }
};

/**
 * Extract the real macOS app icon for the given AppId by reading the bundle's
 * Info.plist (`CFBundleIconFile`) and rendering the resolved .icns via `sips`.
 * Both `plutil` and `sips` ship with every macOS install — no Xcode, swift, or
 * electron-builder bundling required, and no JXA / NSImage drawing path
 * (which is broken in JXA: lockFocus and NSGraphicsContext class methods are
 * not exposed). macOS only; other platforms return undefined.
 */
export const extractAppIcon = async (
  id: OpenInAppId,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> => {
  if (platform !== 'darwin') return undefined;
  try {
    if (!(await areToolsAvailable())) return undefined;
    const bundlePath = await resolveDarwinBundlePath(id);
    if (!bundlePath) return undefined;
    const icnsPath = await resolveIcnsPath(bundlePath);
    if (!icnsPath) return undefined;
    const tmpDir = await ensureTmpDir();
    if (!tmpDir) return undefined;
    return await renderIcnsToDataUrl(icnsPath, tmpDir, `${id}.png`);
  } catch (error) {
    logger.debug(`extractAppIcon error for ${id}: ${(error as Error).message}`);
    return undefined;
  }
};

/**
 * Resolve icons for a list of installed AppIds. Sequential — keeps spawn
 * pressure low and matches the underlying single-thread tools.
 */
export const extractAllIcons = async (
  installedIds: OpenInAppId[],
  platform: NodeJS.Platform = process.platform,
): Promise<Map<OpenInAppId, string>> => {
  const map = new Map<OpenInAppId, string>();
  for (const id of installedIds) {
    try {
      const icon = await extractAppIcon(id, platform);
      if (icon) map.set(id, icon);
    } catch (error) {
      logger.debug(`extractAllIcons: skipping ${id} after error: ${(error as Error).message}`);
    }
  }
  return map;
};

/**
 * Test-only: reset the module-level caches so each test starts fresh.
 */
export const __resetForTest = () => {
  tmpDirPromise = undefined;
  toolsAvailablePromise = undefined;
};
