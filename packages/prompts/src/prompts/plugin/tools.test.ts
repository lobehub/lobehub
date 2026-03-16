import { describe, expect, it } from 'vitest';

import type { Tool } from './tools';
import { apiPrompt, toolPrompt, toolsPrompts } from './tools';

describe('Prompt Generation Utils', () => {
  describe('apiPrompt', () => {
    it('should generate correct api prompt', () => {
      const api = {
        name: 'testApi',
        desc: 'Test API Description',
      };

      expect(apiPrompt(api)).toBe(`<api identifier="testApi">Test API Description</api>`);
    });
  });

  describe('toolPrompt', () => {
    it('should generate tool prompt with instruction', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        systemRole: 'Test System Role',
        apis: [{ name: 'api1', desc: 'API 1 Description' }],
      };

      const expected = `<tool name="testTool">
<tool.instructions>Test System Role</tool.instructions>
</tool>`;

      expect(toolPrompt(tool)).toBe(expected);
    });

    it('should return empty string when no systemRole', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        apis: [{ name: 'api1', desc: 'API 1 Description' }],
      };

      expect(toolPrompt(tool)).toBe('');
    });
  });

  describe('toolsPrompts', () => {
    it('should only include tools with systemRole', () => {
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
          apis: [{ name: 'api2', desc: 'API 2' }],
        },
      ];

      const expected = `<tool name="tool1">
<tool.instructions>Instructions for tool1</tool.instructions>
</tool>`;

      expect(toolsPrompts(tools)).toBe(expected);
    });

    it('should return empty for empty tools array', () => {
      expect(toolsPrompts([])).toBe('');
    });

    it('should return empty when no tools have systemRole', () => {
      const tools: Tool[] = [
        {
          name: 'tool1',
          identifier: 'id1',
          apis: [{ name: 'api1', desc: 'API 1' }],
        },
      ];

      expect(toolsPrompts(tools)).toBe('');
    });
  });
});
