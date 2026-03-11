import { describe, expect, it } from 'vitest';

import type { McpSchema } from '../../types/protocol';
import { generateRFCProtocolUrl, parseProtocolUrl } from '../protocol';

describe('Protocol', () => {
  describe('generateRFCProtocolUrl', () => {
    it('should generate valid RFC protocol URL for stdio type', () => {
      const schema: McpSchema = {
        identifier: 'edgeone-mcp',
        name: 'EdgeOne MCP',
        author: 'Higress Team',
        description: 'EdgeOne API integration for LobeChat',
        version: '1.0.0',
        homepage: 'https://github.com/higress/edgeone-mcp',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@higress/edgeone-mcp'],
          env: { NODE_ENV: 'production' },
        },
      };

      const url = generateRFCProtocolUrl({
        id: 'edgeone-mcp',
        schema,
        marketId: 'higress',
      });

      expect(url).toMatch(/^lobehub:\/\/plugin\/install\?/);
      expect(url).toContain('id=edgeone-mcp');
      expect(url).toContain('marketId=higress');

      // Verify schema is URL encoded
      const urlObj = new URL(url);
      const schemaParam = urlObj.searchParams.get('schema');
      expect(schemaParam).toBeTruthy();
      // URLSearchParams.get() 自动解码，所以这里得到的是解码后的JSON
      expect(schemaParam).toContain('"'); // 解码后的引号
    });

    it('should generate valid RFC protocol URL for http type', () => {
      const schema: McpSchema = {
        identifier: 'awesome-api',
        name: 'Awesome API',
        author: 'Smithery',
        description: 'Awesome API integration',
        version: '2.0.0',
        config: {
          type: 'http',
          url: 'https://api.smithery.ai/v1/mcp',
          headers: {
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'value',
          },
        },
      };

      const url = generateRFCProtocolUrl({
        id: 'awesome-api',
        schema,
        marketId: 'smithery',
      });

      expect(url).toMatch(/^lobehub:\/\/plugin\/install\?/);
      expect(url).toContain('id=awesome-api');
      expect(url).toContain('marketId=smithery');
    });

    it('should throw error if schema identifier does not match id', () => {
      const schema: McpSchema = {
        identifier: 'wrong-id',
        name: 'Test',
        author: 'Test',
        description: 'Test',
        version: '1.0.0',
        config: { type: 'stdio', command: 'test' },
      };

      expect(() => generateRFCProtocolUrl({ id: 'different-id', schema })).toThrowError(
        'Schema identifier must match the id parameter',
      );
    });
  });

  describe('parseProtocolUrl', () => {
    it('should parse RFC protocol URL correctly', () => {
      const schema: McpSchema = {
        identifier: 'test-mcp',
        name: 'Test MCP',
        author: 'Test Author',
        description: 'Test Description',
        version: '1.0.0',
        config: {
          type: 'stdio',
          command: 'test',
          args: ['arg1', 'arg2'],
        },
      };

      const url = generateRFCProtocolUrl({
        id: 'test-mcp',
        schema,
        marketId: 'lobehub',
      });

      const parsed = parseProtocolUrl(url);

      expect(parsed).toBeTruthy();
      expect(parsed?.urlType).toBe('plugin');
      expect(parsed?.action).toBe('install');
      expect(parsed?.params.type).toBe('mcp');
      expect(parsed?.params.id).toBe('test-mcp');
      expect(parsed?.params.marketId).toBe('lobehub');
      expect(parsed?.originalUrl).toBe(url);

      // 验证 schema 可以被解析
      const parsedSchema = JSON.parse(parsed?.params.schema || '{}');
      expect(parsedSchema).toEqual(schema);
    });

    it('should return null for invalid protocol', () => {
      const result = parseProtocolUrl('http://example.com');
      expect(result).toBeNull();
    });

    it('should parse URLs with any action', () => {
      const result = parseProtocolUrl('lobehub://plugin/configure?id=test');
      expect(result).toBeTruthy();
      expect(result?.urlType).toBe('plugin');
      expect(result?.action).toBe('configure');
      expect(result?.params.id).toBe('test');
    });

    it('should parse URLs with any query parameters', () => {
      const result = parseProtocolUrl('lobehub://plugin/install?custom=value&another=param');
      expect(result).toBeTruthy();
      expect(result?.urlType).toBe('plugin');
      expect(result?.action).toBe('install');
      expect(result?.params.custom).toBe('value');
      expect(result?.params.another).toBe('param');
    });

    it('should handle URLs without query parameters', () => {
      const result = parseProtocolUrl('lobehub://plugin/install');
      expect(result).toBeTruthy();
      expect(result?.urlType).toBe('plugin');
      expect(result?.action).toBe('install');
      expect(Object.keys(result?.params || {})).toHaveLength(0);
    });

    it('should return null for URLs without action', () => {
      const result = parseProtocolUrl('lobehub://plugin/');
      expect(result).toBeNull();
    });
  });

  describe('URL encoding/decoding', () => {
    it('should handle special characters correctly', () => {
      const schema: McpSchema = {
        identifier: 'special-chars',
        name: '特殊字符 ñ 🚀',
        author: 'Test <test@example.com>',
        description: 'Description with "quotes" and \'apostrophes\'',
        version: '1.0.0',
        config: {
          type: 'stdio',
          command: 'cmd',
          args: ['arg with spaces', 'arg/with/slashes'],
        },
      };

      const url = generateRFCProtocolUrl({ id: 'special-chars', schema });
      const parsed = parseProtocolUrl(url);

      expect(parsed).toBeTruthy();
      expect(parsed?.params.id).toBe('special-chars');
      expect(parsed?.params.type).toBe('mcp');

      // 验证 schema 可以正确解析
      const parsedSchema = JSON.parse(parsed?.params.schema || '{}');
      expect(parsedSchema).toEqual(schema);
    });

    it('should handle different protocol schemes', () => {
      const testCases = [
        'lobehub://plugin/install?test=value',
        'lobehub-dev://plugin/install?test=value',
        'lobehub-beta://plugin/install?test=value',
        'lobehub-nightly://plugin/install?test=value',
      ];

      testCases.forEach((url) => {
        const parsed = parseProtocolUrl(url);
        expect(parsed).toBeTruthy();
        expect(parsed?.urlType).toBe('plugin');
        expect(parsed?.action).toBe('install');
        expect(parsed?.params.test).toBe('value');
        expect(parsed?.originalUrl).toBe(url);
      });
    });
  });
});
