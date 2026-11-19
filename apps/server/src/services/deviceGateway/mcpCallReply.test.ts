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
