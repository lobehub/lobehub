import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import McpInstallController from '../McpInstallCtr';

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock browserManager
const mockBrowserManager = {
  broadcastToWindow: vi.fn(),
};

const mockApp = {
  browserManager: mockBrowserManager,
} as unknown as App;

describe('McpInstallController', () => {
  let controller: McpInstallController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new McpInstallController(mockApp);
  });

  describe('handleInstallRequest', () => {
    const validStdioSchema = {
      identifier: 'test-plugin',
      name: 'Test Plugin',
      author: 'Test Author',
      description: 'A test plugin',
      version: '1.0.0',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'test-mcp-server'],
      },
    };

    const validHttpSchema = {
      identifier: 'test-http-plugin',
      name: 'Test HTTP Plugin',
      author: 'Test Author',
      description: 'A test HTTP plugin',
      version: '1.0.0',
      config: {
        type: 'http',
        url: 'https://api.example.com/mcp',
      },
    };

    it('should return false when id is missing', async () => {
      const result = await controller.handleInstallRequest({
        id: '',
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should return false when schema is missing for third-party marketplace', async () => {
      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should succeed for official market without schema', async () => {
      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'lobehub',
      });

      expect(result).toBe(true);
      expect(mockBrowserManager.broadcastToWindow).toHaveBeenCalledWith(
        'app',
        'mcpInstallRequest',
        {
          marketId: 'lobehub',
          pluginId: 'test-plugin',
          schema: undefined,
        },
      );
    });

    it('should return false when schema is invalid JSON', async () => {
      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: 'invalid json {',
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should return false when schema structure is invalid', async () => {
      const invalidSchema = {
        identifier: 'test-plugin',
        // missing required fields
      };

      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(invalidSchema),
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should return false when schema identifier does not match id', async () => {
      const schema = { ...validStdioSchema, identifier: 'different-id' };

      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(schema),
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should succeed with valid stdio schema', async () => {
      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(validStdioSchema),
      });

      expect(result).toBe(true);
      expect(mockBrowserManager.broadcastToWindow).toHaveBeenCalledWith(
        'app',
        'mcpInstallRequest',
        {
          marketId: 'third-party',
          pluginId: 'test-plugin',
          schema: validStdioSchema,
        },
      );
    });

    it('should succeed with valid http schema', async () => {
      const result = await controller.handleInstallRequest({
        id: 'test-http-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(validHttpSchema),
      });

      expect(result).toBe(true);
      expect(mockBrowserManager.broadcastToWindow).toHaveBeenCalledWith(
        'app',
        'mcpInstallRequest',
        {
          marketId: 'third-party',
          pluginId: 'test-http-plugin',
          schema: validHttpSchema,
        },
      );
    });

    it('should return false when http schema has invalid URL', async () => {
      const invalidHttpSchema = {
        ...validHttpSchema,
        config: {
          type: 'http',
          url: 'not-a-valid-url',
        },
      };

      const result = await controller.handleInstallRequest({
        id: 'test-http-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(invalidHttpSchema),
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should return false when config type is unknown', async () => {
      const unknownTypeSchema = {
        ...validStdioSchema,
        config: {
          type: 'unknown',
        },
      };

      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(unknownTypeSchema),
      });

      expect(result).toBe(false);
      expect(mockBrowserManager.broadcastToWindow).not.toHaveBeenCalled();
    });

    it('should return false when browserManager is not available', async () => {
      const controllerWithoutBrowserManager = new McpInstallController({} as App);

      const result = await controllerWithoutBrowserManager.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'lobehub',
      });

      expect(result).toBe(false);
    });

    it('should handle schema with optional fields', async () => {
      const schemaWithOptionalFields = {
        ...validStdioSchema,
        homepage: 'https://example.com',
        icon: 'https://example.com/icon.png',
      };

      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(schemaWithOptionalFields),
      });

      expect(result).toBe(true);
      expect(mockBrowserManager.broadcastToWindow).toHaveBeenCalledWith(
        'app',
        'mcpInstallRequest',
        expect.objectContaining({
          schema: schemaWithOptionalFields,
        }),
      );
    });

    it('should return false when stdio config missing command', async () => {
      const invalidStdioSchema = {
        ...validStdioSchema,
        config: {
          type: 'stdio',
          // missing command
        },
      };

      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(invalidStdioSchema),
      });

      expect(result).toBe(false);
    });

    it('should handle schema with env configuration', async () => {
      const schemaWithEnv = {
        ...validStdioSchema,
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'test-mcp-server'],
          env: {
            API_KEY: 'test-key',
          },
        },
      };

      const result = await controller.handleInstallRequest({
        id: 'test-plugin',
        marketId: 'third-party',
        schema: JSON.stringify(schemaWithEnv),
      });

      expect(result).toBe(true);
    });
  });
});
