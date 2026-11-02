import { rmSync } from 'node:fs';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * The app's sign-in, handed to the `lh` that local external agents run.
 *
 * A Claude Code / Codex run launched from this app used to give its shell only
 * the run's ids, so `lh` inside it fell back to the machine's own `lh login` —
 * a separate login most users never made — and failed with "no credential" in
 * a conversation they were plainly signed in to. Built-in agents never hit
 * this: their `lh` commands get the app's token from `CliCtr.buildCliEnv`.
 *
 * The token goes into a file and only its path into the run's env
 * (`LOBEHUB_JWT_FILE`, which the CLI reads ahead of every other source):
 * Codex passes shell env through `-c` argv, readable by any local user via
 * `ps`, and a run outlives the access token, so the value has to be rewritten
 * in place when the app refreshes it. One file serves every run — the app has
 * one sign-in — and it exists only while a run has asked for it and the app is
 * signed in: written on the first local run, rewritten on each refresh,
 * removed on sign-out and on exit.
 */
export const APP_SIGN_IN_FILE_ENV = 'LOBEHUB_JWT_FILE';

export const getAppSignInFilePath = (appStoragePath: string): string =>
  path.join(appStoragePath, 'cli-auth', 'jwt');

/** The file a run asked for, so a refresh or sign-out knows what to touch. */
let publishedPath: string | undefined;

const writeAtomically = async (filePath: string, token: string) => {
  const dir = path.dirname(filePath);
  await mkdir(dir, { mode: 0o700, recursive: true });
  // `mkdir` applies the mode only to a directory it creates.
  await chmod(dir, 0o700);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tmpPath, token, { encoding: 'utf8', mode: 0o600 });
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
};

/** Write the token for runs to read, and remember the file for later refreshes. */
export const publishAppSignIn = async (filePath: string, token: string): Promise<void> => {
  await writeAtomically(filePath, token);
  if (publishedPath === filePath) return;

  publishedPath = filePath;
  process.once('exit', () => {
    try {
      rmSync(filePath, { force: true });
    } catch {
      // best-effort
    }
  });
};

/**
 * Hand a refreshed token to running agents. No-op until a run has asked for the
 * file; never throws, a failed write only leaves the previous token in place.
 */
export const refreshAppSignIn = async (token: string): Promise<void> => {
  if (!publishedPath) return;
  await writeAtomically(publishedPath, token).catch(() => {});
};

/**
 * Remove the token on sign-out. The path stays remembered, so signing in again
 * rewrites it for runs that were started before.
 */
export const withdrawAppSignIn = async (): Promise<void> => {
  if (!publishedPath) return;
  await rm(publishedPath, { force: true }).catch(() => {});
};

/**
 * Env that lets `lh` inside a local agent run act as the user signed in to the
 * app. `undefined` when the app is not signed in to a server, or when the file
 * cannot be written — the run then goes on as before, on the machine's own
 * `lh login`.
 */
export const prepareAppSignInEnv = async ({
  appStoragePath,
  auth,
}: {
  appStoragePath: string;
  auth: {
    getAccessToken: () => Promise<string | null>;
    getServerUrl: () => Promise<string | null>;
  };
}): Promise<Record<string, string> | undefined> => {
  try {
    // Sequential for the reason given in `createLambdaFileStorePort`.
    const serverUrl = await auth.getServerUrl();
    const accessToken = await auth.getAccessToken();
    if (!serverUrl || !accessToken) return undefined;

    const filePath = getAppSignInFilePath(appStoragePath);
    await publishAppSignIn(filePath, accessToken);
    return { [APP_SIGN_IN_FILE_ENV]: filePath, LOBEHUB_SERVER: serverUrl.replace(/\/$/, '') };
  } catch {
    return undefined;
  }
};

/** Test-only: forget the published file. */
export const resetAppSignInForTest = () => {
  publishedPath = undefined;
};
