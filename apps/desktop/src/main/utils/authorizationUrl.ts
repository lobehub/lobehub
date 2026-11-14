import { rename, writeFile } from 'node:fs/promises';

/**
 * Dev launchers set this to a file path to receive the OIDC authorization URL instead of
 * having it opened in the system browser, so a script can approve the request with a test
 * account and several windows never fight over one browser session.
 */
export const AUTH_URL_FILE_ENV = 'LOBE_DESKTOP_AUTH_URL_FILE';

export interface OpenAuthorizationUrlOptions {
  env?: NodeJS.ProcessEnv;
  isDev: boolean;
  move?: typeof rename;
  openExternal: (url: string) => Promise<void>;
  write?: typeof writeFile;
}

/**
 * Hands the authorization URL to the dev launcher when it asked for it, otherwise opens it
 * in the default browser. Packaged builds always open the browser.
 *
 * @returns where the URL went, for logging
 */
export const openAuthorizationUrl = async (
  url: string,
  {
    env = process.env,
    isDev,
    move = rename,
    openExternal,
    write = writeFile,
  }: OpenAuthorizationUrlOptions,
): Promise<'browser' | 'file'> => {
  const file = env[AUTH_URL_FILE_ENV];
  if (isDev && file) {
    // The URL carries the PKCE state; keep it readable by the owner only. Rename into
    // place so a launcher polling the file never reads a partial URL.
    const staging = `${file}.${process.pid}.tmp`;
    await write(staging, url, { mode: 0o600 });
    await move(staging, file);
    return 'file';
  }

  await openExternal(url);
  return 'browser';
};
