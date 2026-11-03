import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Notarize and staple a signed macOS app.
 *
 * Replaces electron-builder's built-in `notarize`, which fails the whole build when
 * `stapler` cannot reach Apple's CloudKit ticket service (Error 68, NSURLErrorDomain -1005).
 * The ticket already exists once notarytool accepts the submission, so stapling is retried
 * instead of resubmitting.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const resolveNotaryCredentialArgs = (environment = process.env) => {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = environment;
  if (APPLE_ID || APPLE_APP_SPECIFIC_PASSWORD) {
    if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
      throw new Error('APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID must all be set');
    }
    return [
      '--apple-id',
      APPLE_ID,
      '--password',
      APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      APPLE_TEAM_ID,
    ];
  }

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = environment;
  if (APPLE_API_KEY || APPLE_API_KEY_ID || APPLE_API_ISSUER) {
    if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
      throw new Error('APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER must all be set');
    }
    return ['--key', APPLE_API_KEY, '--key-id', APPLE_API_KEY_ID, '--issuer', APPLE_API_ISSUER];
  }

  return null;
};

export const stapleWithRetry = async (
  appPath,
  { attempts = 5, delayMs = 30_000, execute = execFileSync, logger = console, wait = sleep } = {},
) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      execute('xcrun', ['stapler', 'staple', '-v', appPath], { encoding: 'utf8', stdio: 'pipe' });
      logger.info(`✅ Stapled notarization ticket (attempt ${attempt}/${attempts})`);
      return attempt;
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`Failed to staple ${appPath} after ${attempts} attempts`, { cause: error });
      }
      logger.warn(
        `⚠️ Staple attempt ${attempt}/${attempts} failed, retrying in ${delayMs / 1000}s`,
      );
      await wait(delayMs);
    }
  }
};

export const notarizeMacApp = async (
  appPath,
  { environment = process.env, execute = execFileSync, logger = console, staple = {} } = {},
) => {
  const credentialArgs = resolveNotaryCredentialArgs(environment);
  if (!credentialArgs) {
    logger.warn('⚠️ No Apple notarization credentials; macOS notarization skipped');
    return { notarized: false };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lobehub-notarize-'));
  const zipPath = path.join(tempDir, `${path.basename(appPath, '.app')}.zip`);

  try {
    execute('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath], {
      stdio: 'inherit',
    });
    logger.info('• submitting app to Apple notary service…');
    const output = execute(
      'xcrun',
      ['notarytool', 'submit', zipPath, ...credentialArgs, '--wait', '--output-format', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
    // notarytool exits 0 for rejected submissions, so the status decides.
    const { id, status } = JSON.parse(output);
    if (status !== 'Accepted') {
      throw new Error(
        `Apple notarization ${status} (submission ${id}); run \`xcrun notarytool log ${id}\` for details`,
      );
    }
    logger.info(`✅ Notarization accepted (submission ${id})`);
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }

  await stapleWithRetry(appPath, { execute, logger, ...staple });
  return { notarized: true };
};
