// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestTfs } from './transport';

const credentials = { authType: 'pat' as const, secret: 'local-test-token', username: '' };
let collection: string;
let redirected = false;
const server = createServer((req, res) => {
  if (req.url?.includes('/redirect')) {
    res.writeHead(302, { location: collection + '/target' }).end();
  } else if (req.url?.includes('/target')) {
    redirected = true;
    res.end('{}');
  } else if (req.url?.includes('/denied')) {
    res.writeHead(403).end('private upstream error');
  } else {
    res.writeHead(200, { 'x-ms-continuationtoken': 'next-page' });
    res.end(JSON.stringify({ authorization: req.headers.authorization, url: req.url }));
  }
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  collection = `http://127.0.0.1:${(server.address() as AddressInfo).port}/Collection`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('TFS HTTP transport', () => {
  it('authenticates with PAT, encodes query values and exposes the continuation token', async () => {
    const result = await requestTfs(collection, credentials, '/_apis/projects', {
      name: 'a & b',
    });
    const body = JSON.parse(result.body.toString());
    expect(body.authorization).toBe(
      'Basic ' + Buffer.from(':' + credentials.secret).toString('base64'),
    );
    expect(new URL(body.url, collection).searchParams.get('name')).toBe('a & b');
    expect(result.continuation).toBe('next-page');
  });

  it('refuses redirects without forwarding the credential', async () => {
    await expect(requestTfs(collection, credentials, '/redirect')).rejects.toMatchObject({
      status: 302,
    });
    expect(redirected).toBe(false);
  });

  it('returns a stable error without exposing the upstream body', async () => {
    await expect(requestTfs(collection, credentials, '/denied')).rejects.toMatchObject({
      message: 'TFS_FORBIDDEN',
      status: 403,
    });
  });

  it('rejects paths outside the configured collection and control characters in credentials', async () => {
    for (const path of ['//elsewhere/api', '/../outside', '/%2e%2e/outside', '/api?extra=true'])
      await expect(requestTfs(collection, credentials, path)).rejects.toThrow(
        'Invalid TFS API path',
      );
    for (const char of ['\n', '\r', '\0', '\t'])
      await expect(
        requestTfs(collection, { ...credentials, secret: 'unsafe' + char }, '/_apis/projects'),
      ).rejects.toThrow('Invalid TFS credentials');
  });
});
