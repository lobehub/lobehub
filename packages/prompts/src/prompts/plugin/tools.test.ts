import { describe, expect, it } from 'vitest';

import type { Tool } from './tools';
import { apiPrompt, toolPrompt, toolsPrompts } from './tools';

describe('Prompt Generation Utils', () => {
  describe('apiPrompt', () => {
    it('should generate correct api prompt', () => {
      const api = { name: 'testApi', desc: 'Test API Description' };
      expect(apiPrompt(api)).toBe(`<api identifier="testApi">Test API Description</api>`);
    });
  });

  describe('toolPrompt', () => {
    it('should use tool.instructions when systemRole is present', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        description: 'Short desc',
        systemRole: 'Detailed instructions',
        apis: [{ name: 'api1', desc: 'API 1' }],
      };

      expect(toolPrompt(tool)).toBe(`<tool name="testTool">
<tool.instructions>Detailed instructions</tool.instructions>
</tool>`);
    });

    it('should use description as children when no systemRole', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        description: 'A useful tool for testing',
        apis: [{ name: 'api1', desc: 'API 1' }],
      };

      expect(toolPrompt(tool)).toBe(`<tool name="testTool">A useful tool for testing</tool>`);
    });

    it('should fallback to "no description" when no systemRole and no description', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        apis: [{ name: 'api1', desc: 'API 1' }],
      };

      expect(toolPrompt(tool)).toBe('<tool name="testTool">no description</tool>');
    });
  });

  describe('toolsPrompts', () => {
    it('should include tools with systemRole and description', () => {
      const tools: Tool[] = [
        {
          name: 'tool1',
          identifier: 'id1',
          systemRole: 'Instructions for tool1',
          apis: [{ name: 'api1', desc: 'API 1' }],
        },
        {
          name: 'tool2',
          identifier: 'id2',
          description: 'Tool 2 description',
          apis: [{ name: 'api2', desc: 'API 2' }],
        },
        {
          name: 'tool3',
          identifier: 'id3',
          apis: [{ name: 'api3', desc: 'API 3' }],
        },
      ];

      const expected = `<tool name="tool1">
<tool.instructions>Instructions for tool1</tool.instructions>
</tool>
<tool name="tool2">Tool 2 description</tool>
<tool name="tool3">no description</tool>`;

      expect(toolsPrompts(tools)).toBe(expected);
    });

    it('should return empty for empty tools array', () => {
      expect(toolsPrompts([])).toBe('');
    });
  });
});
