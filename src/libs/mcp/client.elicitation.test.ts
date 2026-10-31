// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { McpInputRequiredError } from '@lobechat/mcp-elicitation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startElicitationServers } from './__tests__/fixtures/elicitationServers';
import { MCPClient } from './client';

describe('MCP elicitation against real SDK servers', () => {
  let servers: Awaited<ReturnType<typeof startElicitationServers>>;
  const clients: MCPClient[] = [];
  beforeEach(async () => {
    servers = await startElicitationServers();
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.disconnect()));
    await servers.close();
  });
  const connect = async (path: string) => {
    const client = new MCPClient(
      { name: 'elicitation', type: 'http', url: servers.url + path },
      true,
    );
    clients.push(client);
    await client.initialize();
    return client;
  };
  it('pauses modern input and resumes the original call with an exact state echo', async () => {
    const client = await connect('/modern');
    const error = await client.callTool('form', {}).catch((e) => e);
    expect(error).toBeInstanceOf(McpInputRequiredError);
    expect(error.checkpoint.round).toBe(1);
    const result = await client.callTool(
      'form',
      {},
      {
        continuation: {
          ...error.checkpoint,
          inputResponses: { details: { action: 'accept', content: { label: 'hello' } } },
        },
      },
    );
    expect(result.content).toEqual([{ type: 'text', text: 'saved:hello' }]);
  });
  it('preserves a requestState-only URL wait and manually retries the exact original tool', async () => {
    const client = await connect('/modern');
    const initial = await client.callTool('state_url', {}).catch((e) => e);
    const waiting = await client
      .callTool(
        'state_url',
        {},
        {
          continuation: { ...initial.checkpoint, inputResponses: { answer: { action: 'accept' } } },
        },
      )
      .catch((e) => e);
    expect(waiting).toBeInstanceOf(McpInputRequiredError);
    expect(Object.keys(waiting.checkpoint.inputRequired.inputRequests ?? {})).toHaveLength(0);
    expect(waiting.checkpoint.inputRequired.requestState).toBe('external-pending');
    const stillWaiting = await client
      .callTool('state_url', {}, { continuation: { ...waiting.checkpoint, inputResponses: {} } })
      .catch((e) => e);
    expect(stillWaiting).toBeInstanceOf(McpInputRequiredError);
    await fetch(servers.url + '/external/state_url?complete=success');
    const result = await client.callTool(
      'state_url',
      {},
      { continuation: { ...stillWaiting.checkpoint, inputResponses: {} } },
    );
    expect(result.content).toEqual([{ type: 'text', text: 'state_url:completed' }]);
    const trace = await (await fetch(servers.url + '/trace')).json();
    expect(trace.effects).toHaveLength(1);
    const stateOnlyWire = trace.requests.find((r: any) => r.response?.includes('external-pending'));
    expect(JSON.parse(stateOnlyWire.response).result).toEqual({
      resultType: 'input_required',
      requestState: 'external-pending',
    });
    expect(trace.requests.findLast((r: any) => r.method === 'tools/call').params).toMatchObject({
      name: 'state_url',
      arguments: {},
      requestState: 'external-pending',
      inputResponses: {},
    });
  });
  it('retires an aborted hosted legacy invocation only after another ordinary in-flight call finishes', async () => {
    const client = await connect('/legacy');
    const controller = new AbortController();
    let entered!: () => void;
    const active = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hosted = client.callTool(
      'form',
      {},
      {
        timeoutMs: 4000,
        signal: controller.signal,
        host: {
          request: async (_request, { signal }) => {
            entered();
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            );
            return { action: 'cancel' };
          },
        },
      },
    );
    const rejected = hosted.catch((error) => error);
    await active;
    const ordinary = client.callTool('slow_noop', {}, { timeoutMs: 1500 });
    await vi.waitFor(() =>
      expect(
        servers.requests.some(
          (request) =>
            request.method === 'tools/call' &&
            (request.params as { name?: string })?.name === 'slow_noop',
        ),
      ).toBe(true),
    );
    controller.abort();
    expect(await rejected).toBeInstanceOf(Error);
    expect((await ordinary).content).toEqual([{ type: 'text', text: 'slow_noop:complete' }]);
    await expect(client.callTool('noop', {})).rejects.toMatchObject({
      name: 'McpCallNotStartedError',
    });
  });

  it.each(['accept', 'decline', 'cancel'] as const)(
    'legacy %s answers the waiting tool',
    async (action) => {
      const client = await connect('/legacy');
      const result = await client.callTool(
        'form',
        {},
        {
          host: {
            request: async () => ({
              action,
              ...(action === 'accept' && { content: { label: 'hello' } }),
            }),
          },
        },
      );
      expect(result.content).toEqual([
        { type: 'text', text: action === 'accept' ? 'saved:hello' : action },
      ]);
    },
  );
  it('isolates concurrent legacy callers sharing a connection', async () => {
    const client = await connect('/legacy');
    const results = await Promise.all(
      ['first', 'second'].map((label) =>
        client.callTool(
          'form',
          {},
          { host: { request: async () => ({ action: 'accept', content: { label } }) } },
        ),
      ),
    );
    expect(results.map((r) => r.content)).toEqual([
      [{ type: 'text', text: 'saved:first' }],
      [{ type: 'text', text: 'saved:second' }],
    ]);
  });
  it('runs ordinary legacy calls concurrently on one real SDK session', async () => {
    const client = await connect('/legacy');
    const results = await Promise.all([
      client.callTool('parallel', {}, { timeoutMs: 500 }),
      client.callTool('parallel', {}, { timeoutMs: 500 }),
    ]);
    expect(
      results.every(
        (result) =>
          result.content[0].type === 'text' && result.content[0].text === 'parallel:complete',
      ),
    ).toBe(true);
  });
  it('cancels an unsent interactive legacy call without closing the active caller connection', async () => {
    const client = await connect('/legacy');
    let release!: () => void;
    const answer = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstHost = vi.fn(async () => {
      await answer;
      return { action: 'accept' as const, content: { label: 'first' } };
    });
    const first = client.callTool('form', {}, { host: { request: firstHost }, timeoutMs: 3000 });
    await vi.waitFor(() => expect(firstHost).toHaveBeenCalledOnce());
    const abort = new AbortController();
    const secondHost = vi.fn();
    const second = client
      .callTool('form', {}, { host: { request: secondHost }, signal: abort.signal, timeoutMs: 500 })
      .catch((error) => error);
    abort.abort(new Error('cancel queued invocation'));
    try {
      const beforeRelease = await Promise.race([
        second,
        new Promise((resolve) => setTimeout(() => resolve('still queued'), 200)),
      ]);
      expect(beforeRelease).toMatchObject({ name: 'McpCallNotStartedError', retryable: false });
      expect(await client.callTool('noop', {}, { timeoutMs: 500 })).toMatchObject({
        content: [{ text: 'noop:complete' }],
      });
    } finally {
      release();
    }
    expect(await first).toMatchObject({ content: [{ text: 'saved:first' }] });
    expect(secondHost).not.toHaveBeenCalled();
    const trace = await (await fetch(servers.url + '/trace')).json();
    expect(
      trace.requests.filter(
        (row: { method: string; params: { name?: string } }) =>
          row.method === 'tools/call' && row.params.name === 'form',
      ),
    ).toHaveLength(1);
  });
  it.each(['accept', 'decline', 'cancel'] as const)(
    'modern %s is returned to the original request',
    async (action) => {
      const client = await connect('/modern');
      const result = await client.callTool(
        'form',
        {},
        {
          interactive: true,
          host: {
            request: async () => ({
              action,
              ...(action === 'accept' && { content: { label: 'modern' } }),
            }),
          },
        },
      );
      expect(result.content).toEqual([
        { type: 'text', text: action === 'accept' ? 'saved:modern' : action },
      ]);
    },
  );
  it.each(['/modern', '/legacy'])(
    'completes multiple rounds on %s without repeating the side effect',
    async (path) => {
      const client = await connect(path);
      let prompts = 0;
      const result = await client.callTool(
        'multi',
        {},
        {
          interactive: true,
          host: {
            request: async (request) => {
              prompts++;
              return {
                action: 'accept',
                content:
                  request.mode !== 'url' && 'ok' in request.requestedSchema.properties
                    ? { ok: true }
                    : {
                        [request.mode !== 'url' &&
                        'finalLabel' in request.requestedSchema.properties
                          ? 'finalLabel'
                          : 'label']: `round-${prompts}`,
                        choice: 'b',
                        tags: ['green'],
                        confirmed: false,
                        count: 2,
                        email: 'test@example.com',
                      },
              };
            },
          },
        },
      );
      expect(result.isError).not.toBe(true);
      expect(prompts).toBe(path === '/modern' ? 3 : 2);
      expect(servers.effects).toHaveLength(1);
      expect(servers.effects[0].tool).toBe('multi');
    },
  );
  it.each(['/modern', '/legacy'])(
    'does not confuse concurrent modern/legacy hosts on %s',
    async (path) => {
      const client = await connect(path);
      const results = await Promise.all(
        ['Alice', 'Bob'].map((label) =>
          client.callTool(
            'form',
            {},
            {
              interactive: true,
              host: {
                request: async () => {
                  await new Promise((resolve) => setTimeout(resolve, label === 'Alice' ? 20 : 1));
                  return { action: 'accept', content: { label } };
                },
              },
            },
          ),
        ),
      );
      expect(results.map((result) => result.content)).toEqual(
        ['Alice', 'Bob'].map((label) => [{ type: 'text', text: `saved:${label}` }]),
      );
    },
  );
  it.each(['/modern', '/legacy'])(
    'requires external completion, reports failure, and respects URL cancel on %s',
    async (path) => {
      const client = await connect(path);
      for (const action of ['decline', 'cancel'] as const) {
        const result = await client.callTool(
          'url',
          {},
          { interactive: true, host: { request: async () => ({ action }) } },
        );
        expect(result.content).toEqual([{ type: 'text', text: `url:${action}` }]);
        expect(servers.effects).toHaveLength(0);
      }
      let prompts = 0;
      const result = await client.callTool(
        'url',
        {},
        {
          interactive: true,
          host: {
            request: async (request) => {
              prompts++;
              if (prompts === 2 || path === '/legacy')
                await fetch(`${(request as { url: string }).url}?complete=failure`);
              return { action: 'accept' };
            },
          },
        },
      );
      // Modern accept is consent, not proof that the external operation completed.
      expect(prompts).toBe(path === '/modern' ? 2 : 1);
      expect(result.isError).toBe(true);
      expect(servers.effects).toHaveLength(0);
    },
  );
  it('handles old -32042 URL-required retries and never retries a decline', async () => {
    const client = await connect('/legacy');
    const declined = await client.callTool(
      'legacy_url',
      {},
      { interactive: true, host: { request: async () => ({ action: 'decline' }) } },
    );
    expect(declined.isError).toBe(true);
    expect(servers.effects).toHaveLength(0);
    const accepted = await client.callTool(
      'legacy_url',
      {},
      {
        interactive: true,
        host: {
          request: async (request) => {
            await fetch(`${(request as { url: string }).url}?complete=success`);
            return { action: 'accept' };
          },
        },
      },
    );
    expect(accepted.isError).not.toBe(true);
    expect(servers.effects).toHaveLength(1);
  });
  it.each(['/modern', '/legacy'])('bounds the complete user wait on %s', async (path) => {
    const client = await connect(path);
    await expect(
      client.callTool(
        'form',
        {},
        {
          interactive: true,
          timeoutMs: 50,
          host: {
            request: async (_request, { signal }) =>
              new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              }),
          },
        },
      ),
    ).rejects.toThrow();
    expect(servers.effects).toHaveLength(0);
  });

  it.each(['accept', 'decline', 'cancel'] as const)(
    'legacy stdio %s round-trips real protocol requests',
    async (action) => {
      const client = new MCPClient(
        {
          name: 'stdio',
          type: 'stdio',
          command: process.execPath,
          args: [
            fileURLToPath(
              new URL('./__tests__/fixtures/legacyElicitationStdio.mjs', import.meta.url),
            ),
          ],
        },
        true,
      );
      clients.push(client);
      await client.initialize();
      let rounds = 0;
      const result = await client.callTool(
        'form',
        {},
        {
          host: {
            request: async () => {
              rounds++;
              return { action, ...(action === 'accept' && { content: { label: 'stdio' } }) };
            },
          },
        },
      );
      expect(rounds).toBe(action === 'accept' ? 2 : 1);
      expect(result.content).toEqual([
        { type: 'text', text: action === 'accept' ? 'saved:stdio' : action },
      ]);
      const url = await client.callTool(
        'url',
        {},
        {
          host: {
            request: async (request) => {
              expect(request.mode).toBe('url');
              return { action };
            },
          },
        },
      );
      expect(url.content).toEqual([{ type: 'text', text: `url:${action}` }]);
    },
  );
});
