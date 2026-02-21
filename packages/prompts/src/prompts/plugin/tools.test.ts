import { describe, expect, it } from 'vitest';

import type { Tool } from './tools';
import { apiPrompt, toolPrompt, toolsPrompts } from './tools';

describe('Prompt Generation Utils', () => {
  // 测试 apiPrompt 函数
  describe('apiPrompt', () => {
    it('should generate correct api prompt', () => {
      const api = {
        name: 'testApi',
        desc: 'Test API Description',
      };

      expect(apiPrompt(api)).toBe(`<api identifier="testApi">Test API Description</api>`);
    });
  });

  // 测试 toolPrompt 函数
  describe('toolPrompt', () => {
    it('should generate tool prompt with system role', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        systemRole: 'Test System Role',
        apis: [
          {
            name: 'api1',
            desc: 'API 1 Description',
          },
        ],
      };

      const expected = `<collection name="testTool">
<collection.instructions>Test System Role</collection.instructions>
<api identifier="api1">API 1 Description</api>
</collection>`;

      expect(toolPrompt(tool)).toBe(expected);
    });

    it('should generate tool prompt without system role', () => {
      const tool: Tool = {
        name: 'testTool',
        identifier: 'test-id',
        apis: [
          {
            name: 'api1',
            desc: 'API 1 Description',
          },
        ],
      };

      const expected = `<collection name="testTool">

<api identifier="api1">API 1 Description</api>
</collection>`;

      expect(toolPrompt(tool)).toBe(expected);
    });
  });

  // 测试 toolsPrompts 函数
  describe('toolsPrompts', () => {
    it('should generate tools prompts with multiple tools', () => {
      const tools: Tool[] = [
        {
          name: 'tool1',
          identifier: 'id1',
          apis: [
            {
              name: 'api1',
              desc: 'API 1',
            },
          ],
        },
        {
          name: 'tool2',
          identifier: 'id2',
          apis: [
            {
              name: 'api2',
              desc: 'API 2',
            },
          ],
        },
      ];

      const expected = `<collection name="tool1">

<api identifier="api1">API 1</api>
</collection>
<collection name="tool2">

<api identifier="api2">API 2</api>
</collection>`;

      expect(toolsPrompts(tools)).toBe(expected);
    });

    it('should generate tools prompts with empty tools array', () => {
      const tools: Tool[] = [];

      expect(toolsPrompts(tools)).toBe('');
    });
  });
});
