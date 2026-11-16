import { createServer } from 'node:http';

export type OAuthMcpVariant = 'idtoken' | 'userinfo' | 'none';

/** A real HTTP OAuth/MCP fixture, also usable by local product acceptance. */
export const startOAuthMcpServer = async (
  variant: OAuthMcpVariant = 'idtoken',
  port = 0,
  options: { collidingTool?: boolean } = {},
) => {
  const requests: {
    authorization: string | null;
    arguments: Record<string, unknown>;
    tool: string;
  }[] = [];
  const refreshes: string[] = [];
  let base = '';
  let sequence = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, base);
      const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(value));
      };
      let raw = '';
      for await (const chunk of req) raw += chunk.toString();
      const metadata = {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['tools', 'offline_access', 'openid', 'profile', 'email'],
        prompt_values_supported: ['consent', 'select_account'],
        ...(variant === 'userinfo' ? { userinfo_endpoint: `${base}/userinfo` } : {}),
      };
      if (url.pathname === '/__requests') return json({ requests, refreshes });
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return json({
          resource: `${base}/mcp`,
          authorization_servers: [base],
          scopes_supported: ['tools'],
        });
      if (
        url.pathname === '/.well-known/oauth-authorization-server' ||
        url.pathname === '/.well-known/openid-configuration'
      )
        return json(metadata);
      if (url.pathname === '/register')
        return json(
          { ...JSON.parse(raw), client_id: 'fixture-client', token_endpoint_auth_method: 'none' },
          201,
        );
      if (url.pathname === '/authorize') {
        const account = url.searchParams.get('account');
        if (!account) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          const choice = (name: string) => {
            const next = new URL(url);
            next.searchParams.set('account', name);
            return `<a href="${next.pathname}${next.search.replaceAll('&', '&amp;')}">${name}</a>`;
          };
          res.end(`<h1>Choose account</h1>${choice('alice')} ${choice('bob')}`);
          return;
        }
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        callback.searchParams.set('code', account);
        callback.searchParams.set('state', url.searchParams.get('state')!);
        callback.searchParams.set('iss', base);
        res.writeHead(302, { Location: callback.href }).end();
        return;
      }
      if (url.pathname === '/token') {
        const form = new URLSearchParams(raw);
        const refresh = form.get('refresh_token');
        if (refresh) refreshes.push(refresh);
        const account = (refresh ?? form.get('code') ?? 'alice')
          .replace(/^refresh-/, '')
          .split('-')[0];
        const payload = Buffer.from(
          JSON.stringify({
            iss: base,
            sub: account,
            email: `${account}@example.com`,
            name: account,
          }),
        ).toString('base64url');
        return json({
          access_token: `tok-${account}-${++sequence}`,
          refresh_token: `refresh-${account}-${sequence}`,
          token_type: 'Bearer',
          expires_in: 120,
          ...(variant === 'idtoken' ? { id_token: `header.${payload}.signature` } : {}),
        });
      }
      if (url.pathname === '/userinfo') {
        const account = /tok-(alice|bob)-/.exec(req.headers.authorization ?? '')?.[1];
        return account
          ? json({ sub: account, email: `${account}@example.com`, preferred_username: account })
          : json({ error: 'unauthorized' }, 401);
      }
      if (url.pathname !== '/mcp') return json({ error: 'not_found' }, 404);
      if (!req.headers.authorization?.startsWith('Bearer tok-'))
        return json({ error: 'unauthorized' }, 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="tools"`,
        });
      if (req.method === 'GET') {
        res.writeHead(405).end();
        return;
      }
      const rpc = JSON.parse(raw);
      if (rpc.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const reply = (result: unknown) => json({ jsonrpc: '2.0', id: rpc.id, result });
      if (rpc.method === 'initialize')
        return reply({
          protocolVersion: rpc.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'oauth-accounts-fixture', version: '1.0.0' },
        });
      if (rpc.method === 'tools/list')
        return reply({
          tools: [
            {
              name: 'whoami',
              description: 'Return the selected account',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'echo_args',
              description: 'Return received arguments',
              inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
            },
            ...(options.collidingTool
              ? [
                  {
                    name: 'native_link_id',
                    description: 'Echo a business link_id',
                    inputSchema: { type: 'object', properties: { link_id: { type: 'string' } } },
                  },
                ]
              : []),
          ],
        });
      if (rpc.method === 'tools/call') {
        requests.push({
          authorization: req.headers.authorization ?? null,
          arguments: rpc.params.arguments ?? {},
          tool: rpc.params.name,
        });
        return reply({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                account: /tok-(alice|bob)-/.exec(req.headers.authorization)?.[1],
                arguments: rpc.params.arguments ?? {},
              }),
            },
          ],
        });
      }
      json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Method not found' } });
    } catch (error) {
      res.writeHead(500).end(error instanceof Error ? error.message : 'Fixture error');
    }
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing OAuth fixture address');
  base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    requests,
    refreshes,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
};
