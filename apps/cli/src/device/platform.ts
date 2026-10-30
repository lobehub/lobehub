import { readFileSync } from 'node:fs';

/** Android exposes its system properties here; readable without root on stock devices. */
export const ANDROID_BUILD_PROP_PATH = '/system/build.prop';
export const TERMUX_PREFIX = '/data/data/com.termux/files/usr';

export interface DevicePlatformInfo {
  /**
   * Extra facts merged into the device `metadata` bag: `androidVersion` /
   * `androidSdk` / `deviceModel` (from build.prop, for the UI subtitle) and
   * `runtime: 'termux'`. Runtime is metadata only — it never changes `platform`.
   */
  metadata: Record<string, string>;
  /** `process.platform` vocabulary plus `android` / `ios`. */
  platform: string;
}

export interface ResolveDevicePlatformOptions {
  env?: NodeJS.ProcessEnv;
  /** Value of `process.platform` (or `os.platform()`) on this host. */
  hostPlatform?: string;
  /** Reads a file as utf8; throws when it does not exist or is unreadable. */
  readFile?: (path: string) => string;
  /**
   * Platform the client reported explicitly (e.g. a mobile app in its
   * handshake). The only reliable source for iOS, which has no shell to probe.
   */
  reportedPlatform?: string | null;
}

const BUILD_PROP_KEYS = {
  androidSdk: 'ro.build.version.sdk',
  androidVersion: 'ro.build.version.release',
  deviceModel: 'ro.product.model',
} as const;

const parseBuildProp = (content: string): Record<string, string> => {
  const props = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    props.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }

  const result: Record<string, string> = {};
  for (const [field, key] of Object.entries(BUILD_PROP_KEYS)) {
    const value = props.get(key);
    if (value) result[field] = value.slice(0, 200);
  }
  return result;
};

const isTermux = (env: NodeJS.ProcessEnv): boolean =>
  !!env.TERMUX_VERSION || !!env.PREFIX?.startsWith(TERMUX_PREFIX);

/**
 * Resolve the platform this device should register as. `os.platform()` alone
 * is not enough: Android kernels (and Node builds running inside chroot/proot
 * on Android) report `linux`, which would land the device in the desktop
 * bucket. Priority:
 *
 * 1. An explicitly reported platform (client handshake) wins.
 * 2. `android` from the host, or `linux` with a readable `/system/build.prop`
 *    → `android`, with release / SDK / model collected for the subtitle.
 * 3. Termux env (`$PREFIX` / `$TERMUX_VERSION`) → `runtime: 'termux'` metadata.
 *
 * iOS is never inferred from the host — it only comes from step 1.
 */
export const resolveDevicePlatform = ({
  env = process.env,
  hostPlatform = process.platform,
  readFile = (path) => readFileSync(path, 'utf8'),
  reportedPlatform,
}: ResolveDevicePlatformOptions = {}): DevicePlatformInfo => {
  const metadata: Record<string, string> = {};
  let platform = reportedPlatform || hostPlatform;

  // Only Linux-family hosts can be Android; never probe on macOS / Windows,
  // and never second-guess an explicit report.
  if (!reportedPlatform && (hostPlatform === 'linux' || hostPlatform === 'android')) {
    try {
      Object.assign(metadata, parseBuildProp(readFile(ANDROID_BUILD_PROP_PATH)));
      platform = 'android';
    } catch {
      // Not Android (or build.prop is locked down) — keep the host platform.
    }
  }

  // Metadata only: Termux never changes the platform (and so never the icon).
  if (isTermux(env)) metadata.runtime = 'termux';

  return { metadata, platform };
};
