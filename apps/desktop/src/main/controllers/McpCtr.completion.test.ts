import { afterEach, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpCtr from './McpCtr';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('delivers the original receipt after a relay failure with no renderer and never re-executes native tools/call', async () => {
  vi.useFakeTimers();
  let userId = 'owner';
  const config = {
    getRemoteServerUrl: async () => 'https://server.example',
    getAccessToken: async () => 'private-oidc',
    getDesktopBootstrapIdentity: () => ({ userId }),
  };
  const ctr = new McpCtr({ getController: () => config, getService: () => null } as unknown as App);
  const execute = vi
    .spyOn(ctr as unknown as { runMcpToolOnce: () => Promise<unknown> }, 'runMcpToolOnce')
    .mockResolvedValue({ content: 'committed receipt', state: {}, success: true });
  const relay: string[] = [];
  let failures = 1;
  const network = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('beginProducer'))
      return Response.json({
        result: { data: { json: { claimed: true, initiatorUserId: 'owner' } } },
      });
    relay.push(String(init.body));
    return new Response(null, { status: failures-- > 0 ? 503 : 200 });
  });
  vi.stubGlobal('fetch', network);
  const input = {
    env: {},
    toolName: 'form',
    args: {},
    params: { type: 'stdio' as const, name: 'fixture', command: 'node' },
    elicitation: {
      identity: {
        operationId: 'op',
        assistantMessageId: 'assistant',
        toolCallId: 'call_1',
        toolMessageId: 'tool',
        identifier: 'fixture',
        apiName: 'form',
      },
      deadline: Date.now() + 300000,
      relayResult: true,
    },
  };
  await expect(ctr.runStdioMcpTool(input)).resolves.toMatchObject({
    content: 'committed receipt',
    success: true,
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(relay).toHaveLength(2);
  expect(relay[0]).toBe(relay[1]);
  await ctr.runStdioMcpTool(input);
  expect(execute).toHaveBeenCalledOnce();
  expect(relay).toHaveLength(2);
  // A second pending receipt cannot be sent with a different login on retry.
  failures = 1;
  await ctr.runStdioMcpTool({
    ...input,
    elicitation: {
      ...input.elicitation,
      identity: {
        ...input.elicitation.identity,
        toolMessageId: 'other-tool',
        toolCallId: 'call_2',
      },
    },
  });
  await vi.advanceTimersByTimeAsync(0);
  const attempts = relay.length;
  userId = 'another-owner';
  await vi.advanceTimersByTimeAsync(10000);
  expect(relay).toHaveLength(attempts);
});
