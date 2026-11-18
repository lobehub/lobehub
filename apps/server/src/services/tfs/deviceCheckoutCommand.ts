import type { TfsCredentials } from '@lobechat/types';
import { parseTfsRepository, shortTfsBranch } from '@lobechat/utils/tfs';

import { tfsGitCredentialConfig } from './gitCommand';

/** Node is available on both device clients; the checkout must also work on Windows. */
export const buildTfsDeviceCheckout = (input: {
  credential: { tfs: TfsCredentials; urlPrefix: string };
  sources: { path?: string; ref?: string; url: string }[];
}) => {
  for (const source of input.sources) {
    if (
      !parseTfsRepository(source.url, input.credential.urlPrefix) ||
      (source.path &&
        (source.path.startsWith('/') ||
          source.path.includes('\\') ||
          source.path.includes(':') ||
          source.path.split('/').includes('..')))
    )
      throw new Error('Invalid TFS checkout source');
  }
  const config = tfsGitCredentialConfig(input.credential);
  const env = Object.fromEntries([
    ['GIT_TERMINAL_PROMPT', '0'],
    ['GIT_CONFIG_COUNT', String(config.length)],
    ...config.flatMap(([key, value], index) => [
      [`GIT_CONFIG_KEY_${index}`, key],
      [`GIT_CONFIG_VALUE_${index}`, value],
    ]),
  ]);
  // No personal credential appears in the command, result, or repository config.
  const script = `
(async () => {
  const { execFile } = require('node:child_process');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const exec = require('node:util').promisify(execFile);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_TRACE') || key === 'GIT_CURL_VERBOSE') delete env[key];
  const git = async (args) => (await exec('git', ['-c', 'core.hooksPath=' + os.devNull, ...args], { env, timeout: 600000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const sources = ${JSON.stringify(input.sources.map((source) => ({ ...source, ref: shortTfsBranch(source.ref) })))};
  for (const source of sources) {
    const root = await fs.realpath(process.cwd());
    const target = path.resolve(source.path || '.');
    let parent = root;
    for (const part of (source.path || '.').split('/').filter(part => part && part !== '.')) {
      parent = path.join(parent, part);
      await fs.mkdir(parent, { recursive: true });
      if ((await fs.lstat(parent)).isSymbolicLink()) throw new Error('TFS checkout cannot use a symbolic link');
    }
    const actual = await fs.realpath(target);
    const relative = path.relative(root, actual);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('TFS checkout escapes the working folder');
    const entries = await fs.readdir(target);
    if (entries.length) {
      if (entries.includes('.git') && await git(['-C', target, 'remote', 'get-url', 'origin']) === source.url) continue;
      throw new Error('TFS checkout requires an empty working folder; existing files were preserved');
    }
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'lobe-tfs-'));
    try {
      const checkout = path.join(staging, 'repo');
      await git(['clone', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), '--', source.url, checkout]);
    // The selected workspace directory already exists; copy the checkout into it.
    await fs.cp(checkout, target, { recursive: true, force: false });
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  console.log('TFS repository checkout ready.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });`;
  return {
    command: `node -e "eval(Buffer.from('${Buffer.from(script).toString('base64')}','base64').toString())"`,
    env,
  };
};
