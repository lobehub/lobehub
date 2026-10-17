import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * LobeHub Computer Use.app is the LobeHub-branded AUV macOS helper, built,
 * signed and notarized by https://github.com/lobehub/lobehub-auv. It ships
 * inside LobeHub.app untouched: re-signing it would discard its stapled
 * notarization ticket and change the identity that the AUV daemon trusts.
 */
export const COMPUTER_USE_HELPER_APP_NAME = 'LobeHub Computer Use.app';
export const COMPUTER_USE_HELPER_BUNDLE_ID = 'com.lobehub.lobehub-desktop.computer-use';
export const COMPUTER_USE_HELPER_TEAM_ID = '4684H589ZU';
export const COMPUTER_USE_HELPER_RELEASE_REPO = 'lobehub/lobehub-auv';

/** Location inside LobeHub.app, relative to the bundle root. */
export const COMPUTER_USE_HELPER_BUNDLE_PATH = path.posix.join(
  'Contents',
  'Library',
  'Helpers',
  COMPUTER_USE_HELPER_APP_NAME,
);

/** electron-builder `mac.signIgnore` pattern that keeps the helper's own signature. */
export const COMPUTER_USE_HELPER_SIGN_IGNORE =
  '/Contents/Library/Helpers/LobeHub Computer Use\\.app(/|$)';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * The helper release shares its version with AUV, so the pinned `@auv-js/cli`
 * version selects the matching helper.
 */
export const resolveComputerUseHelperVersion = (packageJSON) => {
  const version = packageJSON.dependencies?.['@auv-js/cli'];
  if (!version || !EXACT_VERSION.test(version)) {
    throw new Error(
      `@auv-js/cli must be pinned to an exact version to select the Computer Use helper, got: ${version}`,
    );
  }
  return version;
};

export const resolveComputerUseHelperAsset = ({ arch, version }) => {
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`Unsupported macOS architecture for the Computer Use helper: ${arch}`);
  }
  const name = `LobeHub-Computer-Use-${version}-${arch}.zip`;
  const url = `https://github.com/${COMPUTER_USE_HELPER_RELEASE_REPO}/releases/download/v${version}/${name}`;
  return { checksumUrl: `${url}.sha256`, name, url };
};

const run = (execute, command, args) => {
  const result = execute(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  return result;
};

const STAPLER_VALIDATE_RETRY_DELAYS_MS = [5000, 15_000];

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * `stapler validate` looks the ticket up in Apple's CloudKit service, and CI
 * runners intermittently lose that connection (exit 68, NSURLErrorDomain).
 * Retry before failing the build; a missing or invalid ticket fails every try.
 */
const validateStapledTicket = (execute, appPath, { logger, sleep }) => {
  const attempts = STAPLER_VALIDATE_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; ; attempt++) {
    try {
      return run(execute, 'xcrun', ['stapler', 'validate', appPath]);
    } catch (error) {
      const delay = STAPLER_VALIDATE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      // Logged so a build that only passes on retry stays visible in CI output.
      const reason = String(error.message).split('\n')[0].slice(0, 200);
      logger.warn(
        `⚠️ stapler validate failed (attempt ${attempt + 1}/${attempts}), retrying in ${delay / 1000}s: ${reason}`,
      );
      sleep(delay);
    }
  }
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const download = async (fetchImpl, url) => {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

/**
 * Checks that an unpacked helper is the notarized LobeHub build of `version`.
 * Run before embedding and again after LobeHub.app is signed, which proves
 * electron-builder left the helper's signature and ticket alone.
 */
export const verifyComputerUseHelper = (
  appPath,
  { execute = spawnSync, logger = console, sleep = sleepSync, version } = {},
) => {
  run(execute, 'codesign', ['--verify', '--strict', '--deep', '--verbose=2', appPath]);

  // codesign prints the signing details on stderr.
  const details = run(execute, 'codesign', ['--display', '--verbose=2', appPath]).stderr || '';
  const identifier = /^Identifier=(.+)$/m.exec(details)?.[1]?.trim();
  const teamId = /^TeamIdentifier=(.+)$/m.exec(details)?.[1]?.trim();
  if (identifier !== COMPUTER_USE_HELPER_BUNDLE_ID || teamId !== COMPUTER_USE_HELPER_TEAM_ID) {
    throw new Error(
      `Unexpected Computer Use helper signature: identifier=${identifier}, team=${teamId}`,
    );
  }

  validateStapledTicket(execute, appPath, { logger, sleep });

  if (version) {
    const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
    const bundleVersion = run(execute, 'plutil', [
      '-extract',
      'CFBundleShortVersionString',
      'raw',
      infoPlist,
    ]).stdout.trim();
    if (bundleVersion !== version) {
      throw new Error(`Computer Use helper is ${bundleVersion}, expected ${version}`);
    }
  }
};

/**
 * Downloads the helper zip for this build (cached by version and architecture),
 * checks its published SHA-256, and returns the local zip path.
 */
export const downloadComputerUseHelper = async ({
  arch,
  cacheDir,
  fetchImpl = fetch,
  logger = console,
  version,
}) => {
  const asset = resolveComputerUseHelperAsset({ arch, version });
  const zipPath = path.join(cacheDir, asset.name);

  const expected = (await download(fetchImpl, asset.checksumUrl)).toString('utf8').split(/\s+/)[0];
  if (!/^[\da-f]{64}$/i.test(expected)) {
    throw new Error(`Invalid checksum file for ${asset.name}`);
  }

  const cached = await fs.readFile(zipPath).catch(() => null);
  if (cached && sha256(cached) === expected.toLowerCase()) {
    logger.info(`Using cached ${asset.name}`);
    return zipPath;
  }

  logger.info(`Downloading ${asset.url}`);
  const archive = await download(fetchImpl, asset.url);
  if (sha256(archive) !== expected.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${asset.name}`);
  }
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(zipPath, archive);
  return zipPath;
};

/**
 * Places the verified helper at `Contents/Library/Helpers` of the packaged app.
 * `ditto` keeps the bundle byte-for-byte, so its signature stays valid.
 */
export const embedComputerUseHelper = async ({
  appPath,
  arch,
  cacheDir,
  execute = spawnSync,
  fetchImpl = fetch,
  logger = console,
  version,
}) => {
  const zipPath = await downloadComputerUseHelper({ arch, cacheDir, fetchImpl, logger, version });

  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'lobehub-computer-use-'));
  try {
    run(execute, 'ditto', ['-x', '-k', zipPath, staging]);
    const stagedApp = path.join(staging, COMPUTER_USE_HELPER_APP_NAME);
    verifyComputerUseHelper(stagedApp, { execute, version });

    const destination = path.join(appPath, COMPUTER_USE_HELPER_BUNDLE_PATH);
    await fs.rm(destination, { force: true, recursive: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    run(execute, 'ditto', [stagedApp, destination]);
    logger.info(`✅ Embedded ${COMPUTER_USE_HELPER_APP_NAME} ${version} (${arch})`);
    return destination;
  } finally {
    await fs.rm(staging, { force: true, recursive: true });
  }
};
