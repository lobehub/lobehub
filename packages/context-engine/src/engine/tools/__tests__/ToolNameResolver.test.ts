import { describe, expect, it } from 'vitest';

import { ToolNameResolver } from '../ToolNameResolver';

describe('ToolNameResolver', () => {
  const resolver = new ToolNameResolver();
  describe('generate - basic functionality', () => {
    it('should generate tool name with identifier and api name', () => {
      const result = resolver.generate('test-plugin', 'myAction');
      expect(result).toBe('test-plugin____myAction');
    });

    it('should generate tool name with non-builtin type suffix', () => {
      const result = resolver.generate('test-plugin', 'myAction', 'standalone');
      expect(result).toBe('test-plugin____myAction____standalone');
    });

    it('should treat builtin type as default and skip the suffix', () => {
      const result = resolver.generate('test-plugin', 'myAction', 'builtin');
      expect(result).toBe('test-plugin____myAction');
    });

    it('should treat legacy default type the same as builtin', () => {
      const result = resolver.generate('test-plugin', 'myAction', 'default');
      expect(result).toBe('test-plugin____myAction');
    });

    it('should handle undefined type as builtin', () => {
      const result = resolver.generate('test-plugin', 'myAction');
      expect(result).toBe('test-plugin____myAction');
    });
  });

  describe('generate - long name handling', () => {
    it('should shorten long action names using hash', () => {
      // Create a normal identifier with a very long action name
      const identifier = 'my-plugin';
      const longActionName =
        'very-long-action-name-that-will-cause-the-total-length-to-exceed-64-characters';
      const result = resolver.generate(identifier, longActionName, 'builtin');

      // The result should be shorter than the original would have been
      const originalLength = `${identifier}____${longActionName}`.length;
      expect(result.length).toBeLessThan(originalLength);

      // Builtin tools have no type suffix; identifier and MD5HASH prefix remain
      expect(result).toContain(identifier);
      expect(result).toContain('MD5HASH_');
      expect(result).not.toContain('____builtin');
      expect(result).toMatch(/^my-plugin_{4}MD5HASH_[\da-f]+$/);
    });

    it('should handle identifier that is itself long', () => {
      // Test when identifier itself is very long
      const veryLongIdentifier = 'very-long-plugin-identifier-that-will-cause-overflow';
      const actionName = 'action';
      const result = resolver.generate(veryLongIdentifier, actionName, 'standalone');

      // When both identifier and name cause total >= 64, both get hashed
      expect(result).toContain('MD5HASH_');
      expect(result).toContain('____standalone');
      // Result should be shortened
      const originalLength = `${veryLongIdentifier}____${actionName}____standalone`.length;
      expect(result.length).toBeLessThan(originalLength);
      // With 12-char hashes: MD5HASH_xxx(20) + ____(4) + MD5HASH_xxx(20) + ____(4) + standalone(10) = 58
      expect(result.length).toBeLessThan(64);
    });

    it('should keep short names unchanged', () => {
      const result = resolver.generate('short', 'action', 'type');
      expect(result).toBe('short____action____type');
      expect(result.length).toBeLessThan(64);
    });

    it('should handle edge case at exactly 64 characters', () => {
      // Create a name that's exactly 64 characters
      const identifier = 'short-id';
      const actionName = 'b'.repeat(44);
      const type = 'type'; // 8 + 4 + 44 + 4 + 4 = 64

      const result = resolver.generate(identifier, actionName, type);

      // When total length >= 64, action name should be hashed
      // Result format: identifier____MD5HASH_xxx____type
      expect(result).toContain(identifier);
      expect(result).toContain('MD5HASH_');
      expect(result).toContain(type);
      // The result should be shorter than the original would have been
      const originalLength = `${identifier}____${actionName}____${type}`.length;
      expect(result.length).toBeLessThan(originalLength);
    });
  });

  describe('generate - special characters and edge cases', () => {
    it('should handle identifiers with special characters', () => {
      const result = resolver.generate('my-plugin_v2', 'action-name', 'builtin');
      expect(result).toBe('my-plugin_v2____action-name');
    });

    it('should handle empty action name', () => {
      const result = resolver.generate('plugin', '', 'builtin');
      expect(result).toBe('plugin____');
    });

    it('should handle numeric identifiers and action names', () => {
      const result = resolver.generate('plugin123', 'action456', 'type789');
      expect(result).toBe('plugin123____action456____type789');
    });

    it('should hash invalid api names so provider tool names stay valid', () => {
      const result = resolver.generate('mcp-server', 'get.current/weather', 'mcp');

      expect(result).toMatch(/^mcp-server____MD5HASH_[\da-f]+____mcp$/);
      expect(result).toMatch(/^[\w-]+$/);
      expect(result).not.toContain('get.current/weather');
    });

    it('should hash non-ASCII api names so provider tool names stay valid', () => {
      const result = resolver.generate('custom_mcp_plugin', '中文API', 'mcp');

      expect(result).toMatch(/^custom_mcp_plugin____MD5HASH_[\da-f]+____mcp$/);
      expect(result).toMatch(/^[\w-]+$/);
      expect(result).not.toContain('中文API');
    });

    it('should hash invalid identifiers so provider tool names stay valid', () => {
      const result = resolver.generate('@browser/use', 'open_page', 'mcp');

      expect(result).toMatch(/^MD5HASH_[\da-f]+____open_page____mcp$/);
      expect(result).toMatch(/^[\w-]+$/);
      expect(result).not.toContain('@browser/use');
    });

    it('should be consistent for same inputs', () => {
      const result1 = resolver.generate('plugin', 'action', 'type');
      const result2 = resolver.generate('plugin', 'action', 'type');
      expect(result1).toBe(result2);
    });

    it('should produce different results for different inputs', () => {
      const result1 = resolver.generate('plugin1', 'action', 'type');
      const result2 = resolver.generate('plugin2', 'action', 'type');
      expect(result1).not.toBe(result2);
    });
  });

  describe('generate - hash consistency', () => {
    it('should generate consistent hash for same long action name', () => {
      const identifier = 'plugin';
      const longActionName =
        'very-long-action-name-that-will-also-cause-overflow-with-extra-padding';

      const result1 = resolver.generate(identifier, longActionName, 'builtin');
      const result2 = resolver.generate(identifier, longActionName, 'builtin');

      expect(result1).toBe(result2);
      expect(result1).toContain('MD5HASH_');
    });

    it('should generate different hashes for different long action names', () => {
      const identifier = 'plugin';
      const longActionName1 = 'very-long-action-name-that-will-also-cause-overflow-with-padding-1';
      const longActionName2 = 'very-long-action-name-that-will-also-cause-overflow-with-padding-2';

      const result1 = resolver.generate(identifier, longActionName1, 'builtin');
      const result2 = resolver.generate(identifier, longActionName2, 'builtin');

      expect(result1).not.toBe(result2);
      expect(result1).toContain('MD5HASH_');
      expect(result2).toContain('MD5HASH_');
    });
  });

  describe('generate - real-world examples', () => {
    it('should handle builtin tools correctly', () => {
      const result = resolver.generate('lobe-image-designer', 'text2image', 'builtin');
      expect(result).toBe('lobe-image-designer____text2image');
    });

    it('should handle web browsing tools correctly', () => {
      const result = resolver.generate('lobe-web-browsing', 'search', 'builtin');
      expect(result).toBe('lobe-web-browsing____search');

      const result2 = resolver.generate('lobe-web-browsing', 'crawlSinglePage', 'builtin');
      expect(result2).toBe('lobe-web-browsing____crawlSinglePage');
    });

    it('should handle plugin tools correctly', () => {
      const result = resolver.generate('custom-plugin', 'customAction');
      expect(result).toBe('custom-plugin____customAction');
    });
  });

  describe('resolve - basic functionality', () => {
    it('should resolve normal tool calls without hashing', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{"query": "test"}',
            name: 'test-plugin____myAction',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        'test-plugin': {
          api: [{ description: 'My action', name: 'myAction', parameters: {} }],
          identifier: 'test-plugin',
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        apiName: 'myAction',
        arguments: '{"query": "test"}',
        id: 'call_1',
        identifier: 'test-plugin',
        type: 'builtin' as const,
      });
    });

    it('should fall back to builtin type for two-segment tool names without manifest', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{}',
            name: 'plugin____action',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        plugin: {
          api: [{ description: 'Action', name: 'action', parameters: {} }],
          identifier: 'plugin',
          meta: {},
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result[0].type).toBe('builtin');
    });

    it('should still parse legacy three-segment ____builtin tool names', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{}',
            name: 'legacy-plugin____legacyAction____builtin',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        'legacy-plugin': {
          api: [{ description: '', name: 'legacyAction', parameters: {} }],
          identifier: 'legacy-plugin',
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result[0].type).toBe('builtin');
      expect(result[0].apiName).toBe('legacyAction');
    });

    it('should handle empty tool calls array', () => {
      const result = resolver.resolve([], {});
      expect(result).toEqual([]);
    });

    it('should handle multiple tool calls', () => {
      const toolCalls = [
        {
          function: { arguments: '{}', name: 'plugin1____action1' },
          id: 'call_1',
          type: 'function',
        },
        {
          function: { arguments: '{}', name: 'plugin2____action2' },
          id: 'call_2',
          type: 'function',
        },
      ];

      const manifests = {
        plugin1: {
          api: [{ description: '', name: 'action1', parameters: {} }],
          identifier: 'plugin1',
          meta: {},
        },
        plugin2: {
          api: [{ description: '', name: 'action2', parameters: {} }],
          identifier: 'plugin2',
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(2);
      expect(result[0].identifier).toBe('plugin1');
      expect(result[1].identifier).toBe('plugin2');
    });

    it('should recover tool type from manifest if model strips the suffix (e.g. GLM-4)', () => {
      const toolCalls = [
        {
          function: { arguments: '{}', name: 'lobe-notebook____createDocument' },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        'lobe-notebook': {
          api: [{ description: '', name: 'createDocument', parameters: {} }],
          identifier: 'lobe-notebook',
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('lobe-notebook');
      expect(result[0].apiName).toBe('createDocument');
      expect(result[0].type).toBe('builtin'); // Recovered from manifest!
    });
  });

  describe('resolve - hashed apiName', () => {
    it('should resolve hashed apiName back to original', () => {
      const identifier = 'my-plugin';
      const longActionName =
        'very-long-action-name-that-will-cause-the-total-length-to-exceed-64-characters';

      // Generate a hashed tool name
      const hashedToolName = resolver.generate(identifier, longActionName, 'builtin');

      // Create tool call with hashed name
      const toolCalls = [
        {
          function: {
            arguments: '{"param": "value"}',
            name: hashedToolName,
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      // Create manifest with original api name
      const manifests = {
        [identifier]: {
          api: [{ description: 'Long action', name: longActionName, parameters: {} }],
          identifier,
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].apiName).toBe(longActionName);
      expect(result[0].identifier).toBe(identifier);
      expect(result[0].type).toBe('builtin');
    });

    it('should keep hashed apiName if manifest not found', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{}',
            name: 'plugin____MD5HASH_abc123def456',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const result = resolver.resolve(toolCalls, {});

      expect(result[0].apiName).toBe('MD5HASH_abc123def456');
    });

    it('should keep hashed apiName if api not found in manifest', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{}',
            name: 'plugin____MD5HASH_abc123def456',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        plugin: {
          api: [{ description: '', name: 'differentAction', parameters: {} }],
          identifier: 'plugin',
          meta: {},
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result[0].apiName).toBe('MD5HASH_abc123def456');
    });

    it('should resolve apiName hashed because it contains provider-invalid characters', () => {
      const identifier = 'mcp-server';
      const apiName = 'get.current/weather';
      const toolName = resolver.generate(identifier, apiName, 'mcp');

      const result = resolver.resolve(
        [
          {
            function: {
              arguments: '{"location":"Shanghai"}',
              name: toolName,
            },
            id: 'call_1',
            type: 'function',
          },
        ],
        {
          [identifier]: {
            api: [{ description: 'Get weather', name: apiName, parameters: {} }],
            identifier,
            meta: {},
            type: 'mcp' as const,
          },
        },
      );

      expect(result[0]).toEqual({
        apiName,
        arguments: '{"location":"Shanghai"}',
        id: 'call_1',
        identifier,
        type: 'mcp',
      });
    });

    it('should resolve non-ASCII apiName hashed for provider-safe tool names', () => {
      const identifier = 'custom_mcp_plugin';
      const apiName = '中文API';
      const toolName = resolver.generate(identifier, apiName, 'mcp');

      const result = resolver.resolve(
        [
          {
            function: {
              arguments: '{"query":"最近工作压力好大"}',
              name: toolName,
            },
            id: 'call_1',
            type: 'function',
          },
        ],
        {
          [identifier]: {
            api: [{ description: 'Chat with companion', name: apiName, parameters: {} }],
            identifier,
            meta: {},
            type: 'mcp' as const,
          },
        },
      );

      expect(result[0]).toEqual({
        apiName,
        arguments: '{"query":"最近工作压力好大"}',
        id: 'call_1',
        identifier,
        type: 'mcp',
      });
    });
  });

  describe('resolve - hashed identifier', () => {
    it('should resolve hashed identifier back to original', () => {
      const veryLongIdentifier = 'very-long-plugin-identifier-that-will-cause-overflow';
      const actionName = 'action';

      // Generate a hashed tool name (both identifier and name will be hashed)
      const hashedToolName = resolver.generate(veryLongIdentifier, actionName, 'standalone');

      // Create tool call with hashed name
      const toolCalls = [
        {
          function: {
            arguments: '{"test": true}',
            name: hashedToolName,
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      // Create manifest with original identifier
      const manifests = {
        [veryLongIdentifier]: {
          api: [{ description: 'Action', name: actionName, parameters: {} }],
          identifier: veryLongIdentifier,
          meta: {},
          type: 'standalone' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe(veryLongIdentifier);
      expect(result[0].apiName).toBe(actionName);
      expect(result[0].type).toBe('standalone');
    });

    it('should keep hashed identifier if not found in manifests', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{}',
            name: 'MD5HASH_abc123def456____action',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        'different-plugin': {
          api: [{ description: '', name: 'action', parameters: {} }],
          identifier: 'different-plugin',
          meta: {},
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result[0].identifier).toBe('MD5HASH_abc123def456');
    });

    it('should resolve identifier hashed because it contains provider-invalid characters', () => {
      const identifier = '@browser/use';
      const apiName = 'open_page';
      const toolName = resolver.generate(identifier, apiName, 'mcp');

      const result = resolver.resolve(
        [
          {
            function: {
              arguments: '{}',
              name: toolName,
            },
            id: 'call_1',
            type: 'function',
          },
        ],
        {
          [identifier]: {
            api: [{ description: 'Open page', name: apiName, parameters: {} }],
            identifier,
            meta: {},
            type: 'mcp' as const,
          },
        },
      );

      expect(result[0].identifier).toBe(identifier);
      expect(result[0].apiName).toBe(apiName);
      expect(result[0].type).toBe('mcp');
    });
  });

  describe('resolve - both identifier and apiName hashed', () => {
    it('should resolve both hashed identifier and apiName', () => {
      const veryLongIdentifier = 'very-long-plugin-identifier-that-will-cause-overflow';
      const veryLongActionName = 'very-long-action-name-that-will-also-cause-overflow';

      // Generate hashed tool name (both will be hashed)
      const hashedToolName = resolver.generate(
        veryLongIdentifier,
        veryLongActionName,
        'standalone',
      );

      // Verify both are hashed
      expect(hashedToolName).toContain('MD5HASH_');
      expect(hashedToolName).not.toContain(veryLongIdentifier);
      expect(hashedToolName).not.toContain(veryLongActionName);

      // Create tool call with fully hashed name
      const toolCalls = [
        {
          function: {
            arguments: '{"data": "test"}',
            name: hashedToolName,
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      // Create manifest
      const manifests = {
        [veryLongIdentifier]: {
          api: [{ description: 'Long action', name: veryLongActionName, parameters: {} }],
          identifier: veryLongIdentifier,
          meta: {},
          type: 'standalone' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe(veryLongIdentifier);
      expect(result[0].apiName).toBe(veryLongActionName);
      expect(result[0].type).toBe('standalone');
    });
  });

  describe('resolve - thoughtSignature', () => {
    it('should pass through thoughtSignature when present', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{"query": "test"}',
            name: 'test-plugin____myAction',
          },
          id: 'call_1',
          thoughtSignature: 'thinking about this...',
          type: 'function',
        },
      ];

      const manifests = {
        'test-plugin': {
          api: [{ description: 'My action', name: 'myAction', parameters: {} }],
          identifier: 'test-plugin',
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].thoughtSignature).toBe('thinking about this...');
    });

    it('should handle missing thoughtSignature', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{"query": "test"}',
            name: 'test-plugin____myAction',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const manifests = {
        'test-plugin': {
          api: [{ description: 'My action', name: 'myAction', parameters: {} }],
          identifier: 'test-plugin',
          meta: {},
          type: 'builtin' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].thoughtSignature).toBeUndefined();
    });
  });

  describe('resolve - edge cases', () => {
    it('should filter out invalid tool calls with missing apiName', () => {
      const toolCalls = [
        {
          function: {
            arguments: '{}',
            name: 'invalid-name-without-separator',
          },
          id: 'call_1',
          type: 'function',
        },
      ];

      const result = resolver.resolve(toolCalls, {});

      expect(result).toEqual([]);
    });

    it('should handle tool calls with different types', () => {
      const toolCalls = [
        {
          function: { arguments: '{}', name: 'plugin1____action1' },
          id: 'call_1',
          type: 'function',
        },
        {
          function: { arguments: '{}', name: 'plugin2____action2____standalone' },
          id: 'call_2',
          type: 'function',
        },
        {
          function: { arguments: '{}', name: 'plugin3____action3____mcp' },
          id: 'call_3',
          type: 'function',
        },
      ];

      const manifests = {
        plugin1: {
          api: [{ description: '', name: 'action1', parameters: {} }],
          identifier: 'plugin1',
          meta: {},
          type: 'builtin' as const,
        },
        plugin2: {
          api: [{ description: '', name: 'action2', parameters: {} }],
          identifier: 'plugin2',
          meta: {},
          type: 'standalone' as const,
        },
        plugin3: {
          api: [{ description: '', name: 'action3', parameters: {} }],
          identifier: 'plugin3',
          meta: {},
          type: 'mcp' as const,
        },
      };

      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('builtin');
      expect(result[1].type).toBe('standalone');
      expect(result[2].type).toBe('mcp');
    });
  });

  describe('resolve - real-world integration', () => {
    it('should handle complete generate-resolve roundtrip', () => {
      const identifier = 'lobe-image-designer';
      const apiName = 'text2image';
      const type = 'builtin' as const;

      // Generate tool name
      const toolName = resolver.generate(identifier, apiName, type);

      // Simulate tool call from AI
      const toolCalls = [
        {
          function: {
            arguments: '{"prompt": "a beautiful sunset", "size": "1024x1024"}',
            name: toolName,
          },
          id: 'call_abc123',
          type: 'function',
        },
      ];

      // Create manifest
      const manifests = {
        [identifier]: {
          api: [
            {
              description: 'Generate image from text',
              name: apiName,
              parameters: {
                properties: {
                  prompt: { type: 'string' },
                  size: { type: 'string' },
                },
                type: 'object',
              },
            },
          ],
          identifier,
          meta: { avatar: '', description: '', title: 'Image Designer' },
          type: 'builtin' as const,
        },
      };

      // Resolve tool calls
      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        apiName,
        arguments: '{"prompt": "a beautiful sunset", "size": "1024x1024"}',
        id: 'call_abc123',
        identifier,
        type,
      });
    });

    it('should handle roundtrip with long names requiring hashing', () => {
      const longIdentifier = 'very-long-plugin-identifier-that-exceeds-normal-length';
      const longApiName = 'very-long-api-name-that-also-exceeds-normal-length-limits';
      const type = 'standalone' as const;

      // Generate hashed tool name
      const toolName = resolver.generate(longIdentifier, longApiName, type);
      expect(toolName.length).toBeLessThan(64);

      // Create tool call
      const toolCalls = [
        {
          function: { arguments: '{"input": "data"}', name: toolName },
          id: 'call_xyz789',
          type: 'function',
        },
      ];

      // Create manifest
      const manifests = {
        [longIdentifier]: {
          api: [{ description: 'Long API', name: longApiName, parameters: {} }],
          identifier: longIdentifier,
          meta: {},
          type: 'standalone' as const,
        },
      };

      // Resolve should restore original names
      const result = resolver.resolve(toolCalls, manifests);

      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe(longIdentifier);
      expect(result[0].apiName).toBe(longApiName);
      expect(result[0].type).toBe(type);
    });
  });
});
