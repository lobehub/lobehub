import { spawn } from 'node:child_process';

import dotenv from 'dotenv';

import devTopology from './devTopology';

const { applyDefaultDevTopologyEnv } = devTopology;

dotenv.config();
process.env.LOBE_DEV_TOPOLOGY ||= 'hono-lite';

const devTopologyConfig = applyDefaultDevTopologyEnv(process.env);
process.title = 'lobe-dev-login';

const readArg = (name: string) => {
  const index = process.argv.indexOf(name);

  return index === -1 ? undefined : process.argv[index + 1];
};

const resolveBrowserOpenCommand = (url: string) => {
  if (process.platform === 'win32') {
    return { args: ['url.dll,FileProtocolHandler', url], cmd: 'rundll32' };
  }

  return {
    args: [url],
    cmd: process.platform === 'darwin' ? 'open' : 'xdg-open',
  };
};

const openBrowser = (url: string) => {
  const command = resolveBrowserOpenCommand(url);
  const child = spawn(command.cmd, command.args, {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  child.once('error', (error) => {
    console.error(`Failed to open browser: ${error.message}`);
    console.error(url);
  });
  child.unref();
};

const email = readArg('--email') || process.env.LOBE_DEV_LOGIN_EMAIL || 'dev@local.test';
const name = readArg('--name') || process.env.LOBE_DEV_LOGIN_NAME || 'Local Dev';
const callbackURL = readArg('--callback') || '/';
const url = new URL('/api/auth/dev/local-login', devTopologyConfig.appUrl);

url.searchParams.set('email', email);
url.searchParams.set('name', name);
url.searchParams.set('callbackURL', callbackURL);

console.log(`Opening local dev login URL: ${url.toString()}`);
openBrowser(url.toString());
