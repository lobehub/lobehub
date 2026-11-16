import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withTfsCloudCli } from './cliShim';

const exec = promisify(execFile);
let root: string;
let server: Server;
let address: string;
let requests: { body: unknown; path?: string; workspace?: string }[];
let success: boolean;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lobe-tfs-shim-'));
  await mkdir(path.join(root, 'bin'));
  await writeFile(path.join(root, 'bin/lh'), '#!/bin/sh\necho old-cli-fallback\n');
  await chmod(path.join(root, 'bin/lh'), 0o700);
  requests = [];
  success = true;
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      body: JSON.parse(Buffer.concat(chunks).toString()),
      path: request.url,
      workspace: request.headers['x-workspace-id'] as string,
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({ result: { data: { json: { success, exitCode: success ? 0 : 1 } } } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = server.address();
  if (!endpoint || typeof endpoint === 'string') throw new Error('No HTTP address');
  address = `http://127.0.0.1:${endpoint.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

const run = (command: string, operation = true) =>
  exec('bash', ['-c', withTfsCloudCli(command)], {
    env: {
      ...process.env,
      PATH: `${path.join(root, 'bin')}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      LOBEHUB_JWT: `header.${Buffer.from(JSON.stringify({ purpose: operation ? 'hetero-operation' : 'user' })).toString('base64url')}.signature`,
      LOBEHUB_SERVER: address,
      LOBEHUB_WORKSPACE_ID: 'ws',
      LOBEHUB_TOPIC_ID: 'topic',
    },
  });

describe('TFS server-delivered CLI shim', () => {
  it('works with an older installed CLI and binds the active operation', async () => {
    const result = await run('lh tfs git push --source 1 --branch feature/tfs');
    expect(JSON.parse(result.stdout)).toMatchObject({ success: true });
    expect(requests).toEqual([
      {
        path: '/trpc/lambda/tfs.gitOperation',
        workspace: 'ws',
        body: { json: { operation: 'push', sourceIndex: 1, branch: 'feature/tfs' } },
      },
    ]);
  });
  it('routes ordinary user authentication to the explicitly named topic', async () => {
    await run('lh tfs git fetch --topic other-topic', false);
    expect(requests[0]).toMatchObject({
      path: '/trpc/lambda/tfs.git',
      body: { json: { topicId: 'other-topic' } },
    });
  });
  it('preserves the installed CLI for all other commands', async () => {
    expect((await run('lh topic list')).stdout.trim()).toBe('old-cli-fallback');
    expect(requests).toHaveLength(0);
  });
  it('propagates Git failures and rejects operation redirection', async () => {
    success = false;
    await expect(run('lh tfs git pull')).rejects.toThrow();
    await expect(run('lh tfs git fetch --topic other-topic')).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
});
