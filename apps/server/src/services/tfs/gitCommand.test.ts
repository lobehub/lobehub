// Real Git smart HTTP server: exercises authentication and repository effects, not shell strings.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTfsGitCommand, isTfsGitBranch } from './gitCommand';

const exec = promisify(execFile);
const secret = "test-only-pat'with-quote";
let root: string;
let checkout: string;
let remote: string;
let url: string;
let server: Server;
let authenticated: number;
const git = async (cwd: string, ...args: string[]) =>
  (
    await exec('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    })
  ).stdout.trim();
const run = (operation: 'fetch' | 'pull' | 'push', extra = {}) =>
  exec(
    'bash',
    [
      '-c',
      buildTfsGitCommand({
        branch: 'main',
        credentials: { authType: 'pat', username: '', secret },
        operation,
        url,
        ...extra,
      }),
    ],
    { cwd: checkout },
  );

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lobe-tfs-git-'));
  remote = path.join(root, 'remote.git');
  checkout = path.join(root, 'checkout');
  authenticated = 0;
  await git(root, 'init', '--bare', '--initial-branch=main', remote);
  await git(root, 'clone', remote, checkout);
  await writeFile(path.join(checkout, 'file.txt'), 'initial');
  await git(checkout, 'add', '.');
  await git(checkout, 'commit', '-m', 'initial');
  await git(checkout, 'push', 'origin', 'main');
  server = createServer(async (request, response) => {
    if (
      request.headers.authorization !== `Basic ${Buffer.from(`tfs:${secret}`).toString('base64')}`
    ) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="TFS"' });
      response.end();
      return;
    }
    authenticated++;
    const requestUrl = new URL(request.url!, 'http://localhost');
    const backend = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_HTTP_EXPORT_ALL: '1',
        GIT_PROJECT_ROOT: root,
        PATH_INFO: requestUrl.pathname.replace('/Collection/Project/_git/Repo', '/remote.git'),
        QUERY_STRING: requestUrl.search.slice(1),
        REQUEST_METHOD: request.method,
        CONTENT_TYPE: request.headers['content-type'] ?? '',
        CONTENT_LENGTH: request.headers['content-length'] ?? '',
        REMOTE_USER: 'test',
      },
    });
    request.pipe(backend.stdin);
    const chunks: Buffer[] = [];
    backend.stdout.on('data', (chunk) => chunks.push(chunk));
    backend.on('close', () => {
      const output = Buffer.concat(chunks);
      const end = output.indexOf('\r\n\r\n');
      if (end < 0) {
        response.writeHead(500);
        response.end();
        return;
      }
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of output.subarray(0, end).toString().split('\r\n')) {
        const separator = line.indexOf(':');
        const key = line.slice(0, separator);
        const value = line.slice(separator + 1).trim();
        if (key.toLowerCase() === 'status') status = Number(value.split(' ')[0]);
        else headers[key] = value;
      }
      response.writeHead(status, headers);
      response.end(output.subarray(end + 4));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP server address');
  url = `http://127.0.0.1:${address.port}/Collection/Project/_git/Repo`;
  await git(checkout, 'remote', 'set-url', 'origin', url);
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(root, { recursive: true, force: true });
});

describe('controlled TFS Git operations', () => {
  it('authenticates a later push without persisting the personal credential', async () => {
    await writeFile(path.join(checkout, 'file.txt'), 'changed');
    await git(checkout, 'commit', '-am', 'change');
    await run('push');
    expect(await git(remote, 'rev-parse', 'main')).toBe(await git(checkout, 'rev-parse', 'HEAD'));
    expect(authenticated).toBeGreaterThan(0);
    expect(await readFile(path.join(checkout, '.git/config'), 'utf8')).not.toContain(secret);
  });

  it('pulls remote changes with fast-forward semantics', async () => {
    const writer = path.join(root, 'writer');
    await git(root, 'clone', remote, writer);
    await writeFile(path.join(writer, 'remote.txt'), 'remote change');
    await git(writer, 'add', '.');
    await git(writer, 'commit', '-m', 'remote change');
    await git(writer, 'push');
    await run('pull');
    expect(await readFile(path.join(checkout, 'remote.txt'), 'utf8')).toBe('remote change');
    expect(authenticated).toBeGreaterThan(0);
  });

  it('refuses non-fast-forward pushes and preserves remote history', async () => {
    const original = await git(remote, 'rev-parse', 'main');
    await git(checkout, 'checkout', '--orphan', 'unrelated');
    await git(checkout, 'commit', '-am', 'unrelated');
    await expect(run('push')).rejects.toThrow();
    expect(await git(remote, 'rev-parse', 'main')).toBe(original);
  });

  it('refuses an unrelated checkout before sending credentials over the network', async () => {
    await git(checkout, 'remote', 'set-url', 'origin', 'https://other.example.com/repo');
    await expect(run('fetch')).rejects.toThrow();
    expect(authenticated).toBe(0);
  });

  it('rejects traversal and refspec/option injection', () => {
    for (const branch of [
      '--all',
      'main:other',
      'main..other',
      'main~1',
      'a.lock',
      'a/../b',
      'a\nb',
    ])
      expect(isTfsGitBranch(branch)).toBe(false);
    expect(() =>
      buildTfsGitCommand({
        branch: 'main',
        credentials: { authType: 'pat', secret, username: '' },
        operation: 'fetch',
        path: '../outside',
        url,
      }),
    ).toThrow();
  });
});
