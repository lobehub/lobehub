import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MCPClient } from '../index';

const require = createRequire(import.meta.url);
const mcpHelloWorldRoot = dirname(require.resolve('mcp-hello-world/package.json'));
/** Local stdio entry (see mcp-hello-world `bin`); avoids `npx` so npm never reads this repo's overrides. */
const mcpHelloWorldStdio = join(mcpHelloWorldRoot, 'build', 'stdio.js');

describe('MCPClient', () => {
  // --- Updated Stdio Transport tests ---
  describe('Stdio Transport', () => {
    let mcpClient: MCPClient;
    const TIMEOUT = 120_000;
    const stdioConnection = {
      id: 'mcp-hello-world',
      name: 'Stdio SDK Test Connection',
      type: 'stdio' as const,
      command: process.execPath,
      args: [mcpHelloWorldStdio],
    };

    beforeEach(async () => {
      // args are now set directly in the connection object
      mcpClient = new MCPClient(stdioConnection);
      // Initialize the client - this starts the stdio process
      await mcpClient.initialize();
      // Add a small delay to allow the server process to fully start (optional, but can help)
      await new Promise((resolve) => setTimeout(resolve, 100));
    }, TIMEOUT);

    afterEach(async () => {
      // Assume SDK client/transport handles process termination gracefully
      // If processes leak, more explicit cleanup might be needed here
    }, TIMEOUT);

    it(
      'should create and initialize an instance with stdio transport',
      () => {
        expect(mcpClient).toBeInstanceOf(MCPClient);
      },
      TIMEOUT,
    );

    it(
      'should list tools via stdio',
      async () => {
        const result = await mcpClient.listTools();

        // Check exact length if no other tools are expected
        expect(result).toHaveLength(3);

        // Expect the tools defined in mock-sdk-server.ts
        expect(result).toMatchSnapshot();
      },
      TIMEOUT,
    );

    it(
      'should call the "echo" tool via stdio',
      async () => {
        const toolName = 'echo';
        const toolArgs = { message: 'hello stdio' };
        // Expect the result format defined in mock-sdk-server.ts
        const expectedResult = {
          content: [{ type: 'text', text: 'You said: hello stdio' }],
        };

        const result = await mcpClient.callTool(toolName, toolArgs);
        expect(result).toEqual(expectedResult);
      },
      TIMEOUT,
    );

    it(
      'should call the "add" tool via stdio',
      async () => {
        const toolName = 'add';
        const toolArgs = { a: 5, b: 7 };

        const result = await mcpClient.callTool(toolName, toolArgs);
        expect(result).toEqual({
          content: [{ type: 'text', text: 'The sum is: 12' }],
        });
      },
      TIMEOUT,
    );
  });

  // Regression for https://github.com/lobehub/lobehub/issues/17307:
  // neither the main stdio transport nor the failure-path pre-check may spread
  // the full server process.env into the spawned subprocess, otherwise
  // server-side secrets leak to the MCP process.
  describe('Stdio env isolation (#17307)', () => {
    const TIMEOUT = 120_000;

    it('does not pass server process.env secrets to the main stdio transport', () => {
      const SECRET_KEY = 'LOBE_TEST_SECRET_LEAK';
      const SECRET_VALUE = 'super-secret-should-not-leak-1234';
      const ALLOWED_KEY = 'LOBE_TEST_USER_ENV';
      const ALLOWED_VALUE = 'user-configured-value';

      process.env[SECRET_KEY] = SECRET_VALUE;
      try {
        const mcpClient = new MCPClient({
          id: 'env-leak-transport-test',
          name: 'Env Leak Transport Test',
          type: 'stdio',
          command: process.execPath,
          args: ['-e', ''],
          env: { [ALLOWED_KEY]: ALLOWED_VALUE },
        } as any);

        // The SDK stores the env we hand it verbatim on the transport's server
        // params (default inherited vars are only merged later, at spawn time).
        const transportEnv: Record<string, string> = (mcpClient as any).transport?._serverParams
          ?.env;

        expect(transportEnv).toBeDefined();
        // server secret from process.env must NOT be handed to the transport
        expect(transportEnv[SECRET_KEY]).toBeUndefined();
        // user-configured env vars are still forwarded
        expect(transportEnv[ALLOWED_KEY]).toBe(ALLOWED_VALUE);
      } finally {
        delete process.env[SECRET_KEY];
      }
    });

    it(
      'does not leak server process.env secrets to the pre-check subprocess',
      async () => {
        const SECRET_KEY = 'LOBE_TEST_SECRET_LEAK';
        const SECRET_VALUE = 'super-secret-should-not-leak-1234';
        const ALLOWED_KEY = 'LOBE_TEST_USER_ENV';
        const ALLOWED_VALUE = 'user-configured-value';

        process.env[SECRET_KEY] = SECRET_VALUE;
        try {
          // Print ONLY the two probed keys to stderr (never the whole env), then
          // exit non-zero so the main transport connect fails and the pre-check
          // path we are guarding runs. Keeping the dump narrow avoids writing
          // unrelated CI/server secrets into errorLog if this test ever fails.
          const childScript = `console.error('${SECRET_KEY}=' + (process.env.${SECRET_KEY} ?? '') + '\\n${ALLOWED_KEY}=' + (process.env.${ALLOWED_KEY} ?? '')); process.exit(1);`;
          const mcpClient = new MCPClient({
            id: 'env-leak-test',
            name: 'Env Leak Test',
            type: 'stdio',
            command: process.execPath,
            args: ['-e', childScript],
            env: { [ALLOWED_KEY]: ALLOWED_VALUE },
          } as any);

          let thrown: any;
          try {
            await mcpClient.initialize();
          } catch (error) {
            thrown = error;
          }

          expect(thrown).toBeDefined();
          const errorLog: string = thrown?.data?.metadata?.errorLog ?? '';
          // the child env dumped to stderr must not contain the server secret
          expect(errorLog).not.toContain(SECRET_VALUE);
          // sanity: user-configured env vars are still forwarded to the subprocess
          expect(errorLog).toContain(ALLOWED_VALUE);
        } finally {
          delete process.env[SECRET_KEY];
        }
      },
      TIMEOUT,
    );
  });

  // Error Handling tests remain the same...
  describe('Error Handling', () => {
    it('should throw error for unsupported connection type', () => {
      const connection = {
        id: 'invalid-test',
        name: 'Invalid Test Connection',
        type: 'invalid' as any,
      };
      expect(() => new MCPClient(connection as any)).toThrow(
        'Unsupported MCP connection type: invalid',
      );
    });
  });
});
