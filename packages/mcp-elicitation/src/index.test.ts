import type { Client } from '@modelcontextprotocol/client';
import { expect, it, vi } from 'vitest';

import { McpElicitationClient, McpInputRequiredError, parseMcpElicitationRequest } from './index';

it('does not hand a request to a host after the original invocation was aborted', async () => {
  const abort = new AbortController();
  const host = { request: vi.fn() };
  const client = {
    registerCapabilities: vi.fn(),
    setRequestHandler: vi.fn(),
    getProtocolEra: () => 'modern',
    callTool: async () => {
      abort.abort(new Error('deadline elapsed'));
      throw new McpInputRequiredError({
        round: 0,
        inputRequired: {
          resultType: 'input_required',
          inputRequests: {
            input: {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'Input',
                requestedSchema: { type: 'object', properties: {} },
              },
            },
          },
        },
      });
    },
  } as unknown as Client;
  await expect(
    new McpElicitationClient(client, true).callToolInteractively(
      { name: 'form' },
      { signal: abort.signal },
      host,
    ),
  ).rejects.toThrow('deadline elapsed');
  expect(host.request).not.toHaveBeenCalled();
});
it('enforces the deadline even when a host does not observe cancellation', async () => {
  const client = {
    registerCapabilities: vi.fn(),
    setRequestHandler: vi.fn(),
    getProtocolEra: () => 'modern',
    callTool: async () => {
      throw new McpInputRequiredError({
        round: 0,
        inputRequired: {
          resultType: 'input_required',
          inputRequests: {
            input: {
              method: 'elicitation/create',
              params: {
                mode: 'form',
                message: 'Input',
                requestedSchema: { type: 'object', properties: {} },
              },
            },
          },
        },
      });
    },
  } as unknown as Client;
  await expect(
    new McpElicitationClient(client, true).callToolInteractively(
      { name: 'form' },
      { timeout: 20 },
      { request: async () => new Promise(() => {}) },
    ),
  ).rejects.toThrow();
});

it('uses the modern URL wire schema without requiring a legacy elicitationId', async () => {
  const request = {
    mode: 'url',
    url: 'https://example.com/confirm',
    message: 'Confirm the external flow',
  };
  await expect(parseMcpElicitationRequest(request, true)).resolves.toMatchObject(request);
  await expect(parseMcpElicitationRequest(request, false)).rejects.toThrow('legacy');
  await expect(
    parseMcpElicitationRequest({ ...request, elicitationId: 'legacy-url' }, false),
  ).resolves.toMatchObject({ elicitationId: 'legacy-url' });
});

it('declares no elicitation capability on a connection without an installed host', () => {
  const client = { registerCapabilities: vi.fn(), setRequestHandler: vi.fn() } as unknown as Client;
  new McpElicitationClient(client);
  expect(client.registerCapabilities).not.toHaveBeenCalled();
  expect(client.setRequestHandler).not.toHaveBeenCalled();
  new McpElicitationClient(client, true);
  expect(client.registerCapabilities).toHaveBeenCalledExactlyOnceWith({
    elicitation: { form: {}, url: {} },
  });
});
