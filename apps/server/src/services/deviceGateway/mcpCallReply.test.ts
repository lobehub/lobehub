import { describe, expect, it } from 'vitest';

import {
  classifyMcpCallReply,
  MCP_DEVICE_CLIENT_OUTDATED,
  MCP_DEVICE_EXECUTION_ERROR,
  mcpDeviceCallError,
} from './mcpCallReply';

const call = { apiName: 'worldcreator_status', identifier: 'world-creator' };

describe('classifyMcpCallReply', () => {
  it("turns an old lh connect's unknown-tool reply into an outdated-client error", () => {
    const result = classifyMcpCallReply(call, {
      content: '',
      error: 'Unknown tool API: worldcreator_status',
      success: false,
    });

    expect(result.error).toBe(MCP_DEVICE_CLIENT_OUTDATED);
    expect(result.success).toBe(false);
    expect(result.content).toContain("MCP tool 'worldcreator_status' of 'world-creator'");
    expect(result.content).toContain('`lh update`');
  });

  it('leaves successes, other failures and other tool names alone', () => {
    const success = { content: 'Unknown tool API: worldcreator_status', success: true };
    const other = { content: 'Tool not found', error: 'MCP error -32602', success: false };
    const otherName = { content: '', error: 'Unknown tool API: readFile', success: false };

    expect(classifyMcpCallReply(call, success)).toBe(success);
    expect(classifyMcpCallReply(call, other)).toBe(other);
    expect(classifyMcpCallReply(call, otherName)).toBe(otherName);
  });
});

describe('mcpDeviceCallError', () => {
  it('keeps the outdated-client code and its explanation', () => {
    const outdated = classifyMcpCallReply(call, {
      content: '',
      error: 'Unknown tool API: worldcreator_status',
      success: false,
    });

    expect(mcpDeviceCallError(outdated)).toEqual({
      code: MCP_DEVICE_CLIENT_OUTDATED,
      message: outdated.content,
    });
  });

  it('reports any other failure as a device execution error', () => {
    expect(mcpDeviceCallError({ content: 'timed out', error: 'TIMEOUT', success: false })).toEqual({
      code: MCP_DEVICE_EXECUTION_ERROR,
      message: 'TIMEOUT',
    });
    expect(mcpDeviceCallError({ content: 'timed out', success: false })).toEqual({
      code: MCP_DEVICE_EXECUTION_ERROR,
      message: 'timed out',
    });
  });
});

describe('unreachable MCP endpoint replies (T-14043)', () => {
  const openwrt = {
    apiName: 'system_info',
    identifier: 'openwrt',
    params: { type: 'http', url: 'http://192.168.1.1:8080/mcp?token=secret' },
  };

  it("names the endpoint and cause of an older device's bare probe failure", () => {
    const result = classifyMcpCallReply(openwrt, {
      content: '',
      error: 'Version negotiation probe failed: fetch failed',
      success: false,
    });
    console.log(
      `[T-14043 server repro] legacy device reply\n  content: ${result.content}\n  error: ${JSON.stringify(mcpDeviceCallError(result))}`,
    );

    expect(result.error).toBe('MCP_ENDPOINT_UNREACHABLE');
    expect(result.content).toContain('MCP server unreachable at http://192.168.1.1:8080 ');
    expect(result.content).not.toContain('secret');
    expect(mcpDeviceCallError(result)).toMatchObject({
      attempts: 1,
      code: 'MCP_ENDPOINT_UNREACHABLE',
      endpoint: 'http://192.168.1.1:8080',
      reason: 'network',
      retryable: true,
      via: undefined,
    });
  });

  it('keeps the cause, attempts and probe timeout a current device reports', () => {
    const reply =
      'MCP server unreachable at http://127.0.0.1:3845 from this device: the connection was refused (nothing is listening at that address) (ECONNREFUSED). Start the MCP server (or the app that hosts it) and check the host and port in the connector URL. This is retryable: retry once the server is reachable.\n' +
      '(code: MCP_ENDPOINT_UNREACHABLE, reason: refused, cause: ECONNREFUSED, endpoint: http://127.0.0.1:3845, attempts: 2, probeTimeoutMs: 15000, retryable: true)';
    const result = classifyMcpCallReply(openwrt, { content: '', error: reply, success: false });

    expect(mcpDeviceCallError(result)).toMatchObject({
      attempts: 2,
      causeCode: 'ECONNREFUSED',
      code: 'MCP_ENDPOINT_UNREACHABLE',
      endpoint: 'http://127.0.0.1:3845',
      probeTimeoutMs: 15000,
      reason: 'refused',
      retryable: true,
    });
  });

  it('reads a probe timeout as a retryable timeout', () => {
    const result = classifyMcpCallReply(openwrt, {
      content: '',
      error: 'Version negotiation probe timed out after 60000ms',
      success: false,
    });
    expect(mcpDeviceCallError(result)).toMatchObject({
      code: 'MCP_ENDPOINT_UNREACHABLE',
      probeTimeoutMs: 60000,
      reason: 'timeout',
      retryable: true,
    });
  });

  it('leaves a server that answered with an unusable reply as an execution error', () => {
    const other = {
      content: '',
      error: 'Version negotiation probe failed: the server answered with an unusable reply (x)',
      success: false,
    };
    expect(classifyMcpCallReply(openwrt, other)).toBe(other);
  });
});
