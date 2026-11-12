// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PermissionCheck from '@/libs/mcp/connectorPermissionCheck';

import { ToolExecutionService } from '../index';
import type { ToolExecutionContext } from '../types';
import { applyCodeModeToToolSet } from './collapse';
import { CODE_MODE_IDENTIFIER, CODE_MODE_MAX_RESULT_CHARS } from './constants';

const permissions = vi.hoisted(() => ({
  get: vi.fn<(identifier: string, apiName: string) => Promise<string | null>>(),
}));

vi.mock('@/libs/mcp/connectorPermissionCheck', async (importOriginal) => {
  const actual = await importOriginal<typeof PermissionCheck>();
  return {
    ...actual,
    getConnectorToolPermission: (
      _db: unknown,
      _userId: string,
      identifier: string,
      apiName: string,
    ) => permissions.get(identifier, apiName),
  };
});
vi.mock('@/server/services/mcp/featureGate', () => ({
  isMcpAppsEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: { isConfigured: false },
}));

const mcpManifest = (identifier: string, apiNames: string[]) => ({
  api: apiNames.map((name) => ({
    description: `${name} on ${identifier}`,
    name,
    parameters: { properties: { q: { type: 'string' } }, type: 'object' },
  })),
  identifier,
  mcpParams: { name: identifier, type: 'http', url: `https://${identifier}.example.com/mcp` },
  meta: { title: identifier.toUpperCase() },
  type: 'mcp' as const,
});

/** A tool set with a 20-tool connector folded into Code Mode, as the run would carry it. */
const buildContext = (): ToolExecutionContext => {
  const github = mcpManifest(
    'github',
    Array.from({ length: 20 }, (_, i) => (i === 0 ? 'list_issues' : `tool_${i}`)),
  );
  const toolSet = {
    activatableToolIds: [],
    enabledToolIds: ['github'],
    executorMap: {},
    manifestMap: { github } as Record<string, any>,
    sourceMap: {},
    tools: github.api.map((api) => ({
      function: { name: `github____${api.name}____mcp`, parameters: api.parameters },
      type: 'function' as const,
    })) as any[],
  };
  expect(applyCodeModeToToolSet(toolSet)).toBeDefined();

  return {
    serverDB: {} as any,
    toolManifestMap: toolSet.manifestMap,
    userId: 'user-1',
  };
};

const createService = () => {
  const callTool = vi.fn();
  const service = new ToolExecutionService({
    builtinToolsExecutor: { execute: vi.fn() } as any,
    mcpService: { callTool } as any,
  });
  return { callTool, service };
};

const execute = (service: ToolExecutionService, code: string, context = buildContext()) =>
  service.executeTool(
    {
      apiName: 'execute',
      arguments: JSON.stringify({ code }),
      id: 'call_1',
      identifier: CODE_MODE_IDENTIFIER,
      type: 'builtin',
    },
    context,
  );

describe('Code Mode through ToolExecutionService', () => {
  beforeEach(() => {
    permissions.get.mockReset().mockResolvedValue(null);
  });

  it('runs script tool calls through the regular MCP path and returns the combined result', async () => {
    const { callTool, service } = createService();
    callTool.mockResolvedValue({
      content: '[{"number":1},{"number":2}]',
      state: { content: [{ text: '[{"number":1},{"number":2}]', type: 'text' }] },
      success: true,
    });

    const result = await execute(
      service,
      `const issues = await tools.github.list_issues({ q: 'open' });
       return { count: issues.length };`,
    );

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        argsStr: '{"q":"open"}',
        clientParams: expect.objectContaining({ url: 'https://github.example.com/mcp' }),
        toolName: 'list_issues',
      }),
    );
    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      result: { count: 2 },
      toolCalls: [{ name: 'github.list_issues', success: true }],
    });
  });

  it('prefers the structured MCP result over its text', async () => {
    const { callTool, service } = createService();
    callTool.mockResolvedValue({
      content: 'Found 1 issue',
      state: { content: [], structuredContent: { total: 1 } },
      success: true,
    });

    const result = await execute(service, `return await tools.github.list_issues({});`);

    expect(JSON.parse(result.content).result).toEqual({ total: 1 });
  });

  it('checks the permission before every call and surfaces a disabled tool as an error', async () => {
    const { callTool, service } = createService();
    permissions.get.mockImplementation(async (_identifier, apiName) =>
      apiName === 'tool_1' ? 'disabled' : null,
    );
    callTool.mockResolvedValue({ content: 'ok', state: { content: [] }, success: true });

    const result = await execute(
      service,
      `await tools.github.list_issues({});
       try { await tools.github.tool_1({}); }
       catch (error) { return { code: error.code, message: error.message }; }`,
    );

    // list_issues and tool_1 were each looked up; tool_1 never reached the MCP server.
    expect(permissions.get).toHaveBeenCalledWith('github', 'list_issues');
    expect(permissions.get).toHaveBeenCalledWith('github', 'tool_1');
    expect(callTool).toHaveBeenCalledTimes(1);

    const body = JSON.parse(result.content);
    expect(body.result.code).toBe('TOOL_DISABLED');
    expect(body.result.message).toContain('disabled by the user');
    expect(body.toolCalls).toEqual([
      { name: 'github.list_issues', success: true },
      { name: 'github.tool_1', success: false },
    ]);
  });

  it('refuses a tool that started needing approval after the run was assembled', async () => {
    const { callTool, service } = createService();
    permissions.get.mockResolvedValue('needs_approval');

    const result = await execute(service, `return await tools.github.list_issues({});`);

    expect(callTool).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'TOOL_NEEDS_APPROVAL', kind: 'stop' });
  });

  it('refuses a tool outside the folded connectors', async () => {
    const { callTool, service } = createService();
    const context = buildContext();
    // Present in the manifest map (e.g. discoverable) but never folded.
    (context.toolManifestMap as Record<string, any>).gmail = mcpManifest('gmail', ['send']);

    const result = await execute(service, `return await callTool('gmail.send', {});`, context);

    expect(callTool).not.toHaveBeenCalled();
    expect(result.error).toMatchObject({ code: 'UNKNOWN_TOOL' });
  });

  it('passes an MCP failure into the script as a thrown error', async () => {
    const { callTool, service } = createService();
    callTool.mockResolvedValue({
      content: 'rate limited',
      error: { message: 'rate limited' },
      state: { content: [], isError: true },
      success: false,
    });

    const result = await execute(
      service,
      `try { await tools.github.list_issues({}); } catch (error) { return error.message; }`,
    );

    expect(JSON.parse(result.content).result).toContain('rate limited');
  });

  it('marks a failed script as not retryable', async () => {
    const { service } = createService();

    const result = await execute(service, `throw new Error('nope');`);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: 'SCRIPT_ERROR', kind: 'stop' });
    expect(JSON.parse(result.content).error.message).toBe('Error: nope');
  });

  it('truncates an oversized result', async () => {
    const { service } = createService();

    const result = await execute(service, `return 'x'.repeat(${CODE_MODE_MAX_RESULT_CHARS * 2});`);

    expect(result.success).toBe(true);
    expect(result.content.length).toBeLessThan(CODE_MODE_MAX_RESULT_CHARS + 500);
  });

  it('rejects an empty script', async () => {
    const { service } = createService();

    const result = await execute(service, '   ');

    expect(result.error).toMatchObject({ code: 'INVALID_ARGUMENTS' });
  });

  describe('docs', () => {
    const docs = (service: ToolExecutionService, args: Record<string, unknown>) =>
      service.executeTool(
        {
          apiName: 'docs',
          arguments: JSON.stringify(args),
          id: 'call_docs',
          identifier: CODE_MODE_IDENTIFIER,
          type: 'builtin',
        },
        buildContext(),
      );

    it('lists every folded tool with a summary', async () => {
      const { service } = createService();

      const body = JSON.parse((await docs(service, {})).content);

      expect(body.connectors).toHaveLength(1);
      expect(body.connectors[0]).toMatchObject({ identifier: 'github', title: 'GITHUB' });
      expect(body.connectors[0].tools).toHaveLength(20);
      expect(body.connectors[0].tools[0]).toEqual({
        name: 'github.list_issues',
        summary: 'list_issues on github',
      });
    });

    it('returns the input schema of named tools and reports unknown names', async () => {
      const { service } = createService();

      const body = JSON.parse(
        (await docs(service, { tools: ['github.list_issues', 'github.nope'] })).content,
      );

      expect(body.tools).toEqual([
        {
          description: 'list_issues on github',
          inputSchema: { properties: { q: { type: 'string' } }, type: 'object' },
          name: 'github.list_issues',
        },
      ]);
      expect(body.unknown).toEqual(['github.nope']);
    });

    it('expands a bare connector identifier to all its tools', async () => {
      const { service } = createService();

      const body = JSON.parse((await docs(service, { tools: ['github'] })).content);

      expect(body.tools).toHaveLength(20);
    });
  });

  it('skips the connector permission lookup for the Code Mode call itself', async () => {
    const { service } = createService();

    await service.executeTool(
      {
        apiName: 'docs',
        arguments: '{}',
        id: 'c',
        identifier: CODE_MODE_IDENTIFIER,
        type: 'builtin',
      },
      buildContext(),
    );

    expect(permissions.get).not.toHaveBeenCalled();
  });
});
