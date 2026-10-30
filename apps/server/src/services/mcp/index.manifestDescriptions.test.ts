import type * as LobeConst from '@lobechat/const';
import { pluginPrompts } from '@lobechat/prompts';
import type { ToolManifest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MCPClient } from '@/libs/mcp';

import { MCPService } from './index';

vi.mock('@/libs/mcp');
vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<typeof LobeConst>()),
  isDesktop: true,
}));

const tools = [{ inputSchema: { type: 'object' as const }, name: 'hello' }];
const scenarios = [
  {
    expected: 'test-mcp MCP server has 1 tool',
    manifest: { prompts: undefined, resources: undefined, tools },
    name: 'tools only',
  },
  {
    expected: 'test-mcp MCP server has no tools, prompts, or resources',
    manifest: { prompts: [], resources: [], tools: [] },
    name: 'empty capabilities',
  },
  {
    expected: 'test-mcp MCP server has 1 prompt, 1 resource, 1 tool',
    manifest: {
      prompts: [{ name: 'greet' }],
      resources: [{ name: 'readme', uri: 'file:///readme' }],
      tools,
    },
    name: 'all capabilities',
  },
];

describe('MCP automatic descriptions and installed tool prompts', () => {
  let service: MCPService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MCPService();
    vi.mocked(MCPClient.prototype.listTools).mockResolvedValue(tools);
    vi.mocked(MCPClient.prototype.listManifests).mockResolvedValue({
      prompts: undefined,
      resources: undefined,
      title: undefined,
      tools,
      version: undefined,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(scenarios)(
    'generates a nonempty English description: $name',
    async ({ manifest, expected }) => {
      vi.mocked(MCPClient.prototype.listManifests).mockResolvedValue({
        ...manifest,
        title: undefined,
        version: undefined,
      });
      const result = await service.getStdioMcpServerManifest({ command: 'mcp', name: 'test-mcp' });

      expect(result.meta.description).toBe(expected);
      expect(result.meta.description).not.toContain('undefined');
    },
  );

  it.each([
    { expected: 'test-mcp MCP server has no tools, prompts, or resources', tools: [] },
    { expected: 'test-mcp MCP server has 1 tool, like "hello"', tools },
  ])(
    'generates an HTTP description without an absent tool example: $expected',
    async (scenario) => {
      vi.mocked(MCPClient.prototype.listTools).mockResolvedValue(scenario.tools);
      const result = await service.getStreamableMcpServerManifest(
        'test-mcp',
        'https://mcp.example.com',
      );

      expect(result.meta.description).toBe(scenario.expected);
      expect(result.meta.description).not.toContain('undefined');
    },
  );

  it.each(['stdio', 'http'] as const)(
    'keeps the installed %s manifest description in pluginPrompts',
    async (transport) => {
      const manifest =
        transport === 'stdio'
          ? await service.getStdioMcpServerManifest({ command: 'mcp', name: 'test-mcp' })
          : await service.getStreamableMcpServerManifest('test-mcp', 'https://mcp.example.com');
      // Installation persists this manifest as JSON. Exercise the read-back shape
      // and the same description field consumed by ToolSystemRoleProvider.
      // eslint-disable-next-line unicorn/prefer-structured-clone -- Exercise JSON persistence, not an in-memory clone.
      const installed: ToolManifest = JSON.parse(JSON.stringify(manifest));
      const prompt = pluginPrompts({
        tools: [
          {
            apis: installed.api.map((api) => ({ desc: api.description, name: api.name })),
            description: installed.meta.description,
            identifier: installed.identifier,
            name: installed.meta.title,
          },
        ],
      });

      expect(prompt).not.toContain('no description');
      expect(prompt).toContain('<tool name="test-mcp">test-mcp MCP server has 1 tool');
      expect(prompt).not.toContain('undefined');
    },
  );
});
