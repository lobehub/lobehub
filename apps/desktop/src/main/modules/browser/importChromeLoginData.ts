import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import path from 'node:path';

import type { Cookie, Session } from 'electron';

const DEFAULT_CHROME_PROFILE = 'Default';
const DEVTOOLS_PORT_FILE = 'DevToolsActivePort';
const DEVTOOLS_TIMEOUT = 15_000;

interface CdpCookie extends Omit<Cookie, 'domain' | 'expirationDate' | 'sameSite'> {
  domain: string;
  expires?: number;
  sameSite?: 'Lax' | 'None' | 'Strict';
}

interface CdpResponse {
  error?: { message: string };
  id: number;
  result?: { cookies?: CdpCookie[] };
}

interface ChromeLocalState {
  profile?: { last_used?: string };
}

const chromeLocations = () => {
  const home = homedir();

  switch (platform()) {
    case 'darwin': {
      return {
        executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        userData: path.join(home, 'Library/Application Support/Google/Chrome'),
      };
    }
    case 'win32': {
      return {
        executable: path.join(
          process.env.PROGRAMFILES || 'C:\\Program Files',
          'Google/Chrome/Application/chrome.exe',
        ),
        userData: path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/User Data'),
      };
    }
    default: {
      return {
        executable: '/usr/bin/google-chrome',
        userData: path.join(home, '.config/google-chrome'),
      };
    }
  }
};

const waitForDevTools = async (userData: string) => {
  const portFile = path.join(userData, DEVTOOLS_PORT_FILE);
  const deadline = Date.now() + DEVTOOLS_TIMEOUT;

  while (Date.now() < deadline) {
    try {
      const [port, browserPath] = (await readFile(portFile, 'utf8')).trim().split('\n');
      if (port && browserPath) return `ws://127.0.0.1:${port}${browserPath}`;
    } catch {
      // Chrome creates DevToolsActivePort asynchronously after startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('Timed out while starting Chrome');
};

const readCookies = (webSocketUrl: string): Promise<CdpCookie[]> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Timed out while reading Chrome login information'));
    }, DEVTOOLS_TIMEOUT);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
    });
    socket.addEventListener('message', (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (response.id !== 1) return;

      clearTimeout(timeout);
      socket.close();
      if (response.error) reject(new Error(response.error.message));
      else resolve(response.result?.cookies ?? []);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Could not connect to the temporary Chrome profile'));
    });
  });

const toElectronSameSite = (sameSite?: CdpCookie['sameSite']): Cookie['sameSite'] => {
  switch (sameSite) {
    case 'Lax': {
      return 'lax';
    }
    case 'None': {
      return 'no_restriction';
    }
    case 'Strict': {
      return 'strict';
    }
    default: {
      return 'unspecified';
    }
  }
};

export const importChromeLoginData = async (browserSession: Session): Promise<number> => {
  const { executable, userData } = chromeLocations();
  const localStatePath = path.join(userData, 'Local State');
  const localState = JSON.parse(await readFile(localStatePath, 'utf8')) as ChromeLocalState;
  const profile = localState.profile?.last_used || DEFAULT_CHROME_PROFILE;
  await Promise.all([
    access(executable, constants.X_OK),
    access(path.join(userData, profile), constants.R_OK),
  ]);

  const temporaryUserData = await mkdtemp(path.join(tmpdir(), 'lobehub-chrome-import-'));
  const temporaryProfile = path.join(temporaryUserData, profile);
  let chromeProcess: ReturnType<typeof spawn> | undefined;

  try {
    await Promise.all([
      cp(localStatePath, path.join(temporaryUserData, 'Local State')),
      cp(path.join(userData, profile), temporaryProfile, {
        filter: (source) =>
          !['Cache', 'Code Cache', 'GPUCache', 'LOCK', 'SingletonCookie', 'SingletonLock'].includes(
            path.basename(source),
          ),
        recursive: true,
      }),
    ]);

    chromeProcess = spawn(
      executable,
      [
        `--user-data-dir=${temporaryUserData}`,
        `--profile-directory=${profile}`,
        '--remote-debugging-port=0',
        '--headless=new',
        '--disable-extensions',
        '--no-first-run',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    const cookies = await readCookies(await waitForDevTools(temporaryUserData));
    let imported = 0;

    for (const cookie of cookies) {
      try {
        const domain = cookie.domain.replace(/^\./, '');
        await browserSession.cookies.set({
          domain: cookie.domain,
          expirationDate: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined,
          httpOnly: cookie.httpOnly,
          name: cookie.name,
          path: cookie.path || '/',
          sameSite: toElectronSameSite(cookie.sameSite),
          secure: cookie.secure,
          url: `${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path || '/'}`,
          value: cookie.value,
        });
        imported += 1;
      } catch {
        // Invalid or unsupported cookies should not prevent the rest of the profile importing.
      }
    }

    await browserSession.cookies.flushStore();
    return imported;
  } finally {
    chromeProcess?.kill('SIGTERM');
    await rm(temporaryUserData, { force: true, recursive: true });
  }
};
