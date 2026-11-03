import { describe, expect, it } from 'vitest';

import { genServerConfig } from './utils';

describe('genServerConfig', () => {
  it('should generate HTTP MCP server config with url', () => {
    const result = genServerConfig('context7', {
      type: 'http',
      url: 'https://mcp.context7.com/mcp',
    } as any);

    const config = JSON.parse(result);

    expect(config).toEqual({
      mcpServers: {
        context7: {
          url: 'https://mcp.context7.com/mcp',
        },
      },
    });
  });

  it('should generate stdio MCP server config with command and args', () => {
    const result = genServerConfig('github', {
      args: ['-y', '@modelcontextprotocol/server-github'],
      command: 'npx',
      type: 'stdio',
    } as any);

    const config = JSON.parse(result);

    expect(config).toEqual({
      mcpServers: {
        github: {
          args: ['-y', '@modelcontextprotocol/server-github'],
          command: 'npx',
        },
      },
    });
  });

  it('should handle empty connection config', () => {
    const result = genServerConfig('test-plugin', {} as any);

    const config = JSON.parse(result);

    expect(config).toEqual({
      mcpServers: {
        'test-plugin': {
          args: [],
          command: {},
        },
      },
    });
  });

  it('should handle undefined connection', () => {
    const result = genServerConfig('test-plugin', undefined);

    const config = JSON.parse(result);

    expect(config).toEqual({
      mcpServers: {
        'test-plugin': {
          args: [],
          command: {},
        },
      },
    });
  });

  it('should prioritize url over command/args when both exist', () => {
    const result = genServerConfig('hybrid', {
      args: ['arg1'],
      command: 'cmd',
      type: 'http',
      url: 'https://example.com/mcp',
    } as any);

    const config = JSON.parse(result);

    // Should only include url, not command/args
    expect(config).toEqual({
      mcpServers: {
        hybrid: {
          url: 'https://example.com/mcp',
        },
      },
    });
  });
});
