import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';

import { AskUserBridge } from './AskUserBridge';
import { AskUserMcpServer } from './AskUserMcpServer';
import { ASK_USER_MCP_SERVER_NAME, ASK_USER_TOOL_FULL_NAME, ASK_USER_TOOL_NAME } from './constants';

let server: AskUserMcpServer;

afterEach(async () => {
  await server?.stop();
});

describe('AskUserMcpServer', () => {
  describe('lifecycle', () => {
    it('starts on port=0 (auto-assigned), exposes a localhost URL, stops cleanly', async () => {
      server = new AskUserMcpServer();
      const { port, url } = await server.start();
      expect(port).toBeGreaterThan(0);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

      await server.stop();
      // After stop, calling .url throws — server is no longer listening.
      expect(() => server.url).toThrow();
    });

    it('start() is idempotent', async () => {
      server = new AskUserMcpServer();
      const a = await server.start();
      const b = await server.start();
      expect(a.port).toBe(b.port);
    });
  });

  describe('per-op routing', () => {
    it('hasOperation / operationCount track register / unregister', async () => {
      server = new AskUserMcpServer();
      await server.start();

      expect(server.operationCount).toBe(0);
      const bridge1 = server.registerOperation('op-1');
      const bridge2 = server.registerOperation('op-2');
      expect(server.operationCount).toBe(2);
      expect(server.hasOperation('op-1')).toBe(true);
      expect(server.hasOperation('op-3')).toBe(false);
      expect(bridge1).toBeInstanceOf(AskUserBridge);
      expect(bridge2).toBeInstanceOf(AskUserBridge);
      expect(bridge1).not.toBe(bridge2);

      server.unregisterOperation('op-1');
      expect(server.operationCount).toBe(1);
      expect(server.hasOperation('op-1')).toBe(false);
    });

    it('rejects double-registering the same op id', async () => {
      server = new AskUserMcpServer();
      await server.start();
      server.registerOperation('op-1');
      expect(() => server.registerOperation('op-1')).toThrow(/already registered/);
    });

    it('urlForOperation appends ?op=<id> to the base url', async () => {
      server = new AskUserMcpServer();
      await server.start();
      server.registerOperation('op-7');
      const url = server.urlForOperation('op-7');
      expect(url).toContain('/mcp');
      expect(new URL(url).searchParams.get('op')).toBe('op-7');
    });

    it('unregisterOperation cancels pending bridges', async () => {
      server = new AskUserMcpServer();
      await server.start();
      const bridge = server.registerOperation('op-1');

      const pending = bridge.pending({ arguments: { questions: [{ q: 'foo' }] } });
      // Drain the request event so the iterator's queue doesn't deadlock.
      void bridge.events()[Symbol.asyncIterator]().next();

      server.unregisterOperation('op-1');
      const answer = await pending;
      expect(answer).toEqual({ cancelReason: 'session_ended', cancelled: true });
    });

    it('publishes the canonical mcp__lobe_cc__ask_user_question tool', async () => {
      server = new AskUserMcpServer();
      await server.start();
      server.registerOperation('probe-op');

      const client = await connectClient(server.urlForOperation('probe-op'));
      try {
        const list = await client.listTools();
        expect(list.tools).toHaveLength(1);
        expect(list.tools[0].name).toBe(ASK_USER_TOOL_NAME);
        expect(ASK_USER_TOOL_FULL_NAME).toBe(
          `mcp__${ASK_USER_MCP_SERVER_NAME}__${ASK_USER_TOOL_NAME}`,
        );
      } finally {
        await client.close();
      }
    });
  });

  describe('end-to-end tool call', () => {
    it('routes a tools/call to the right per-op bridge and returns the user answer', async () => {
      server = new AskUserMcpServer({ pendingTimeoutMs: 30_000, progressIntervalMs: 1000 });
      await server.start();
      const bridge = server.registerOperation('op-A');

      // Producer-side: when an intervention_request shows up on bridge.events,
      // resolve it with a fake user answer.
      let interventionRequestSeen: any;
      const producerLoop = (async () => {
        for await (const e of bridge.events()) {
          if (e.type === 'agent_intervention_request') {
            interventionRequestSeen = e;
            bridge.resolve(e.data.toolCallId, {
              result: { 'What color do you want?': 'Red' },
            });
            break;
          }
        }
      })();

      // Client-side: behave like CC — initialize, list, call.
      const client = await connectClient(server.urlForOperation('op-A'));
      try {
        const list = await client.listTools();
        expect(list.tools[0].name).toBe(ASK_USER_TOOL_NAME);

        const callResult = (await client.callTool({
          arguments: {
            questions: [
              {
                header: 'Color',
                options: [
                  { description: 'Red color', label: 'Red' },
                  { description: 'Blue color', label: 'Blue' },
                ],
                question: 'What color do you want?',
              },
            ],
          },
          name: ASK_USER_TOOL_NAME,
        })) as { content: Array<{ text: string; type: string }>; isError?: boolean };

        expect(callResult.isError).toBeFalsy();
        expect(callResult.content[0].text).toContain('User answers');
        expect(callResult.content[0].text).toContain('What color do you want?: Red');
      } finally {
        await client.close();
      }

      await producerLoop;
      expect(interventionRequestSeen).toBeDefined();
      expect(interventionRequestSeen.operationId).toBe('op-A');
      expect(interventionRequestSeen.data.identifier).toBe('claude-code');
      expect(interventionRequestSeen.data.apiName).toBe('askUserQuestion');
    });

    it('returns an isError tool result when the user cancels', async () => {
      server = new AskUserMcpServer({ pendingTimeoutMs: 30_000, progressIntervalMs: 1000 });
      await server.start();
      const bridge = server.registerOperation('op-cancel');

      const producerLoop = (async () => {
        for await (const e of bridge.events()) {
          if (e.type === 'agent_intervention_request') {
            bridge.resolve(e.data.toolCallId, { cancelled: true, cancelReason: 'user_cancelled' });
            break;
          }
        }
      })();

      const client = await connectClient(server.urlForOperation('op-cancel'));
      try {
        const callResult = (await client.callTool({
          arguments: {
            questions: [
              {
                header: 'X',
                options: [
                  { description: 'a', label: 'A' },
                  { description: 'b', label: 'B' },
                ],
                question: 'pick',
              },
            ],
          },
          name: ASK_USER_TOOL_NAME,
        })) as { content: Array<{ text: string; type: string }>; isError?: boolean };

        expect(callResult.isError).toBe(true);
        expect(callResult.content[0].text.toLowerCase()).toContain('cancel');
      } finally {
        await client.close();
      }
      await producerLoop;
    });

    /**
     * Regression: a single shared `StreamableHTTPServerTransport` rejects the
     * second `initialize` with `Server already initialized`, breaking every
     * op after the first. Ensures we mint one transport+McpServer per session.
     */
    it('handles sequential ops on independent sessions', async () => {
      server = new AskUserMcpServer({ pendingTimeoutMs: 30_000, progressIntervalMs: 1000 });
      await server.start();

      for (const opId of ['op-seq-1', 'op-seq-2', 'op-seq-3']) {
        const bridge = server.registerOperation(opId);
        const producerLoop = (async () => {
          for await (const e of bridge.events()) {
            if (e.type === 'agent_intervention_request') {
              bridge.resolve(e.data.toolCallId, { result: { pick: 'A' } });
              break;
            }
          }
        })();

        const client = await connectClient(server.urlForOperation(opId));
        try {
          const callResult = (await client.callTool({
            arguments: {
              questions: [
                {
                  header: opId,
                  options: [
                    { description: 'a', label: 'A' },
                    { description: 'b', label: 'B' },
                  ],
                  question: 'pick',
                },
              ],
            },
            name: ASK_USER_TOOL_NAME,
          })) as { content: Array<{ text: string }>; isError?: boolean };

          expect(callResult.isError).toBeFalsy();
          expect(callResult.content[0].text).toContain('pick: A');
        } finally {
          await client.close();
        }
        await producerLoop;
        server.unregisterOperation(opId);
      }
    });
  });
});

const connectClient = async (url: string): Promise<Client> => {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: 'unit-test', version: '0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
};
