import { describe, expect, it } from 'vitest';

import { getMcpServerDescription } from './mcpServerDescription';

describe('getMcpServerDescription', () => {
  it.each([
    { capabilities: {}, summary: 'no tools, prompts, or resources' },
    {
      capabilities: { prompts: [], resources: [], tools: [] },
      summary: 'no tools, prompts, or resources',
    },
    { capabilities: { tools: [{ name: 'hello' }] }, summary: '1 tool' },
    {
      capabilities: { prompts: [{}], resources: [{}, {}], tools: [{ name: 'a' }, { name: 'b' }] },
      summary: '1 prompt, 2 resources, 2 tools',
    },
  ])('describes available capabilities: $summary', ({ capabilities, summary }) => {
    const description = getMcpServerDescription('example', capabilities);
    expect(description).toBe(`example MCP server has ${summary}`);
    expect(description).not.toContain('undefined');
  });

  it('only adds a tool example when a tool exists', () => {
    expect(getMcpServerDescription('example', { tools: [] }, { includeToolExample: true })).toBe(
      'example MCP server has no tools, prompts, or resources',
    );
    expect(
      getMcpServerDescription(
        'example',
        { tools: [{ name: 'hello' }] },
        { includeToolExample: true },
      ),
    ).toBe('example MCP server has 1 tool, like "hello"');
  });
});
