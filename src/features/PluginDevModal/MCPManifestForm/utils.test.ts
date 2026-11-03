import { describe, expect, it } from 'vitest';

import { McpParseErrorCode, parseMcpInput } from './utils';

describe('parseMcpInput', () => {
  // Test Suite 1: Valid Nested mcpServers Structure
  describe('Nested mcpServers Structure', () => {
    it('should correctly parse valid stdio config', () => {
      const input = JSON.stringify({
        mcpServers: {
          'sequential-thinking': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
          },
        },
      });
      const expected = {
        status: 'success',
        identifier: 'sequential-thinking',
        mcpConfig: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
          type: 'stdio',
        },
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should correctly parse valid http config', () => {
      const input = JSON.stringify({
        mcpServers: {
          'some-http-service': {
            url: 'https://example.com/api',
          },
        },
      });
      const expected = {
        status: 'success',
        identifier: 'some-http-service',
        mcpConfig: {
          url: 'https://example.com/api',
          type: 'http',
        },
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should correctly parse valid http config with empty string identifier', () => {
      const input = JSON.stringify({
        mcpServers: {
          '': {
            url: 'https://router.mcp.so/mcp/mdvp27m9tl2bxs',
          },
        },
      });
      const expected = {
        status: 'success',
        identifier: '',
        mcpConfig: {
          url: 'https://router.mcp.so/mcp/mdvp27m9tl2bxs',
          type: 'http',
        },
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error for empty mcpServers object', () => {
      const input = JSON.stringify({ mcpServers: {} });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.EmptyMcpServers,
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error for invalid structure within mcpServers config', () => {
      const input = JSON.stringify({
        mcpServers: {
          'invalid-config': {}, // Missing command/args or url
        },
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidMcpStructure,
        identifier: 'invalid-config',
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error if mcpConfig is not an object', () => {
      const input = JSON.stringify({
        mcpServers: {
          'not-an-object': 'hello',
        },
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidMcpStructure,
        identifier: 'not-an-object',
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error if mcpConfig is null', () => {
      const input = JSON.stringify({
        mcpServers: {
          'is-null': null,
        },
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidMcpStructure,
        identifier: 'is-null',
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });
  });

  // Test Suite 2: Valid Flat Structure (Top-level Identifier)
  describe('Flat Structure (Top-level Identifier)', () => {
    it('should correctly parse valid stdio config', () => {
      const input = JSON.stringify({
        'flat-stdio-service': {
          command: 'go',
          args: ['run', 'main.go'],
        },
      });
      const expected = {
        status: 'success',
        identifier: 'flat-stdio-service',
        mcpConfig: {
          command: 'go',
          args: ['run', 'main.go'],
          type: 'stdio',
        },
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should correctly parse valid http config', () => {
      const input = JSON.stringify({
        'mcp-wolframalpha': {
          url: 'https://mcp.higress.ai/mcp-wolframalpha/abc',
        },
      });
      const expected = {
        status: 'success',
        identifier: 'mcp-wolframalpha',
        mcpConfig: {
          url: 'https://mcp.higress.ai/mcp-wolframalpha/abc',
          type: 'http',
        },
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error for invalid structure within flat config', () => {
      const input = JSON.stringify({
        'invalid-flat': {}, // Missing command/args or url
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidMcpStructure,
        identifier: 'invalid-flat',
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error if the value associated with the identifier is not an object', () => {
      const input = JSON.stringify({
        'flat-not-object': 'just a string',
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidMcpStructure,
        identifier: 'flat-not-object',
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error if the value associated with the identifier is null', () => {
      const input = JSON.stringify({
        'flat-is-null': null,
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidMcpStructure,
        identifier: 'flat-is-null',
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return error for multiple top-level keys', () => {
      const input = JSON.stringify({
        key1: { url: 'url1' },
        key2: { url: 'url2' },
      });
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidJsonStructure, // Because it's not a single-key flat structure nor mcpServers/manifest
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });
  });

  // Test Suite 4: Invalid Inputs and Edge Cases
  describe('Invalid Inputs and Edge Cases', () => {
    it('should return noop for invalid JSON string', () => {
      const input = 'this is not json';
      const expected = { status: 'noop' };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return noop for empty string', () => {
      const input = '';
      const expected = { status: 'noop' };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return noop for null input', () => {
      // @ts-ignore testing invalid input type
      const input = null;
      const expected = { status: 'noop' };
      expect(parseMcpInput(input as any)).toEqual(expected);
    });

    it('should return noop for undefined input', () => {
      // @ts-ignore testing invalid input type
      const input = undefined;
      const expected = { status: 'noop' };
      expect(parseMcpInput(input as any)).toEqual(expected);
    });

    it('should return InvalidJsonStructure for empty JSON object', () => {
      const input = JSON.stringify({});
      // Empty object is considered an invalid structure because it doesn't match any expected format
      const expected = {
        status: 'error',
        errorCode: McpParseErrorCode.InvalidJsonStructure,
      };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return noop for JSON array', () => {
      const input = JSON.stringify([]);
      const expected = { status: 'noop' };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return noop for JSON primitive (string)', () => {
      const input = JSON.stringify('just a string');
      const expected = { status: 'noop' };
      expect(parseMcpInput(input)).toEqual(expected);
    });

    it('should return noop for JSON primitive (number)', () => {
      const input = JSON.stringify(123);
      const expected = { status: 'noop' };
      expect(parseMcpInput(input)).toEqual(expected);
    });
  });
});
