import type { Server } from 'node:http';
import { createServer } from 'node:http';

import type { AuthorizationServerMetadata } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverConnectorOAuth, exchangeConnectorCode, refreshConnectorToken } from './oauth';

/**
 * Real socket tests: no fetch mocks. The MCP server URL and everything its
 * metadata advertises (authorization server, token endpoint) come from the
 * connector owner, so every request must go through the SSRF-safe transport.
 */
describe('connector OAuth network boundary', () => {
  let server: Server;
  let base: string;
  let requests: { body: string; method: string; url: string }[];
  let streamClosed: Promise<void>;
  let onStreamClosed: () => void;

  beforeEach(async () => {
    requests = [];
    streamClosed = new Promise((resolve) => (onStreamClosed = resolve));
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({ body, method: req.method!, url: req.url! });
        const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
          res.end(JSON.stringify(value));
        };
        if (req.url === '/stream/mcp') {
          // A server that opens its SSE stream for any GET and never ends it.
          res.on('close', () => onStreamClosed());
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write(': connected\n\n');
        } else if (req.url === '/.well-known/oauth-protected-resource/stream/mcp') {
          json(200, { authorization_servers: [`${base}/as`], resource: `${base}/stream/mcp` });
        } else if (req.url === '/mcp') {
          json(
            401,
            { error: 'unauthorized' },
            {
              'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
            },
          );
        } else if (req.url === '/.well-known/oauth-protected-resource/mcp') {
          json(200, { authorization_servers: [`${base}/as`], resource: `${base}/mcp` });
        } else if (req.url === '/.well-known/oauth-authorization-server/as') {
          json(200, metadata());
        } else if (req.url === '/as/token') {
          json(200, { access_token: 'tok', refresh_token: 'rt', token_type: 'Bearer' });
        } else {
          json(404, { error: 'not_found' });
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    base = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const metadata = (): AuthorizationServerMetadata =>
    ({
      authorization_endpoint: `${base}/as/authorize`,
      issuer: `${base}/as`,
      response_types_supported: ['code'],
      token_endpoint: `${base}/as/token`,
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    }) as AuthorizationServerMetadata;

  const exchange = () =>
    exchangeConnectorCode({
      authorizationCode: 'code',
      authorizationServerUrl: `${base}/as`,
      clientInformation: { client_id: 'cid', client_secret: 'secret' },
      codeVerifier: 'verifier',
      metadata: metadata(),
      redirectUri: 'https://app.example.com/oauth/connector/callback',
    });

  it('refuses to discover OAuth metadata on a private address', async () => {
    await expect(discoverConnectorOAuth(`${base}/mcp`)).rejects.toThrow(/SSRF blocked/);
    expect(requests).toEqual([]);
  });

  it('refuses to send credentials to a private token endpoint', async () => {
    await expect(exchange()).rejects.toThrow(/SSRF blocked/);
    await expect(
      refreshConnectorToken({
        authorizationServerUrl: `${base}/as`,
        clientInformation: { client_id: 'cid', client_secret: 'secret' },
        metadata: metadata(),
        refreshToken: 'rt',
      }),
    ).rejects.toThrow(/SSRF blocked/);
    expect(requests).toEqual([]);
  });

  it('reads only the probe headers and closes a probe that opens an endless stream', async () => {
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');

    await expect(discoverConnectorOAuth(`${base}/stream/mcp`)).resolves.toMatchObject({
      authorizationServerUrl: `${base}/as`,
    });
    // The probe must release the SSE connection instead of leaving it open.
    await streamClosed;
  }, 2000);

  it('runs discovery and the token exchange when private addresses are allowed', async () => {
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', '1');

    await expect(discoverConnectorOAuth(`${base}/mcp`)).resolves.toEqual({
      authorizationServerUrl: `${base}/as`,
      metadata: expect.objectContaining({ token_endpoint: `${base}/as/token` }),
    });
    await expect(exchange()).resolves.toEqual({
      authMethod: undefined,
      tokens: expect.objectContaining({ access_token: 'tok' }),
    });

    const token = requests.find((request) => request.url === '/as/token');
    expect(token?.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(token!.body))).toMatchObject({
      client_id: 'cid',
      client_secret: 'secret',
      code: 'code',
      grant_type: 'authorization_code',
    });
  });
});
