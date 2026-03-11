import { createServer } from 'node:http';

import { getPort } from 'get-port-please';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '../../App';
import { StaticFileServerManager } from '../StaticFileServerManager';

// Mock get-port-please
vi.mock('get-port-please', () => ({
  getPort: vi.fn().mockResolvedValue(33250),
}));

// Create mock server and handler storage
const mockServerHandler = { current: null as any };
const mockServer = {
  close: vi.fn((cb?: () => void) => cb?.()),
  listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
  on: vi.fn(),
};

// Mock node:http
vi.mock('node:http', () => ({
  createServer: vi.fn((handler: any) => {
    mockServerHandler.current = handler;
    return mockServer;
  }),
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock LOCAL_STORAGE_URL_PREFIX
vi.mock('@/const/dir', () => ({
  LOCAL_STORAGE_URL_PREFIX: '/lobe-desktop-file',
}));

describe('StaticFileServerManager', () => {
  let manager: StaticFileServerManager;
  let mockApp: App;
  let mockFileService: { getFile: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset server handler
    mockServerHandler.current = null;

    // Reset getPort mock to default behavior
    vi.mocked(getPort).mockResolvedValue(33250);

    // Reset server mock behaviors
    mockServer.listen.mockImplementation((_port: number, _host: string, cb: () => void) => cb());
    mockServer.close.mockImplementation((cb?: () => void) => cb?.());
    mockServer.on.mockReset();

    // Create mock FileService
    mockFileService = {
      getFile: vi.fn().mockResolvedValue({
        content: new ArrayBuffer(10),
        mimeType: 'image/png',
      }),
    };

    // Create mock App
    mockApp = {
      getService: vi.fn().mockReturnValue(mockFileService),
    } as unknown as App;

    manager = new StaticFileServerManager(mockApp);
  });

  afterEach(() => {
    // Ensure cleanup
    if ((manager as any).isInitialized) {
      manager.destroy();
    }
  });

  describe('constructor', () => {
    it('should initialize with app reference and get FileService', () => {
      expect(mockApp.getService).toHaveBeenCalled();
    });
  });

  describe('initialize', () => {
    it('should get available port and start HTTP server', async () => {
      await manager.initialize();

      expect(getPort).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 33_250,
        ports: [33_251, 33_252, 33_253, 33_254, 33_255],
      });
      expect(createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(33250, '127.0.0.1', expect.any(Function));
    });

    it('should skip initialization if already initialized', async () => {
      await manager.initialize();

      // Clear mocks after first initialization
      vi.mocked(getPort).mockClear();
      vi.mocked(createServer).mockClear();

      await manager.initialize();

      expect(getPort).not.toHaveBeenCalled();
      expect(createServer).not.toHaveBeenCalled();
    });

    it('should throw error when port acquisition fails', async () => {
      const error = new Error('No available port');
      vi.mocked(getPort).mockRejectedValue(error);

      await expect(manager.initialize()).rejects.toThrow('No available port');
    });

    it('should handle server startup error', async () => {
      const serverError = new Error('Address in use');

      // Mock server.on to capture error handler
      let errorHandler: ((err: Error) => void) | undefined;
      mockServer.on.mockImplementation((event: string, handler: any) => {
        if (event === 'error') {
          errorHandler = handler;
        }
        return mockServer;
      });

      // Mock listen to not call callback but trigger error
      mockServer.listen.mockImplementation(() => {
        // Trigger error after a tick
        setTimeout(() => {
          if (errorHandler) {
            errorHandler(serverError);
          }
        }, 0);
        return mockServer;
      });

      await expect(manager.initialize()).rejects.toThrow('Address in use');
    });
  });

  describe('HTTP request handling', () => {
    beforeEach(async () => {
      // Reset mock server behavior
      mockServer.listen.mockImplementation((_port, _host, cb) => cb());
      await manager.initialize();
    });

    it('should handle OPTIONS request with CORS headers', async () => {
      const req = {
        headers: { origin: 'http://localhost:3000' },
        method: 'OPTIONS',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/test.png',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(204, {
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Max-Age': '86400',
      });
      expect(res.end).toHaveBeenCalled();
    });

    it('should serve file with correct content type and CORS headers', async () => {
      const fileContent = new ArrayBuffer(100);
      mockFileService.getFile.mockResolvedValue({
        content: fileContent,
        mimeType: 'image/jpeg',
      });

      const req = {
        headers: { origin: 'http://127.0.0.1:3000' },
        method: 'GET',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/images/test.jpg',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(mockFileService.getFile).toHaveBeenCalledWith('desktop://images/test.jpg');
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:3000',
        'Cache-Control': 'public, max-age=31536000',
        'Content-Length': expect.any(Number),
        'Content-Type': 'image/jpeg',
      });
      expect(res.end).toHaveBeenCalled();
    });

    it('should return 400 for empty file path', async () => {
      const req = {
        headers: {},
        method: 'GET',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/plain' });
      expect(res.end).toHaveBeenCalledWith('Bad Request: Empty file path');
    });

    it('should return 404 when file not found', async () => {
      const notFoundError = new Error('File not found');
      notFoundError.name = 'FileNotFoundError';
      mockFileService.getFile.mockRejectedValue(notFoundError);

      const req = {
        headers: { origin: 'http://localhost:3000' },
        method: 'GET',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/nonexistent.png',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Content-Type': 'text/plain',
      });
      expect(res.end).toHaveBeenCalledWith('File Not Found');
    });

    it('should return 500 for server errors', async () => {
      mockFileService.getFile.mockRejectedValue(new Error('Database error'));

      const req = {
        headers: {},
        method: 'GET',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/test.png',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(500, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain',
      });
      expect(res.end).toHaveBeenCalledWith('Internal Server Error');
    });

    it('should skip processing if response is already destroyed', async () => {
      const req = {
        headers: {},
        method: 'GET',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/test.png',
      };
      const res = {
        destroyed: true,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
      expect(mockFileService.getFile).not.toHaveBeenCalled();
    });

    it('should handle URL-encoded file paths', async () => {
      const req = {
        headers: {},
        method: 'GET',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/lobe-desktop-file/path%20with%20spaces/file%20name.png',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(mockFileService.getFile).toHaveBeenCalledWith(
        'desktop://path with spaces/file name.png',
      );
    });
  });

  describe('CORS handling', () => {
    beforeEach(async () => {
      mockServer.listen.mockImplementation((_port, _host, cb) => cb());
      await manager.initialize();
    });

    it('should return specific origin for localhost', async () => {
      const req = {
        headers: { origin: 'http://localhost:3000' },
        method: 'OPTIONS',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/test',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(
        204,
        expect.objectContaining({
          'Access-Control-Allow-Origin': 'http://localhost:3000',
        }),
      );
    });

    it('should return specific origin for 127.0.0.1', async () => {
      const req = {
        headers: { origin: 'http://127.0.0.1:8080' },
        method: 'OPTIONS',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/test',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(
        204,
        expect.objectContaining({
          'Access-Control-Allow-Origin': 'http://127.0.0.1:8080',
        }),
      );
    });

    it('should return * for other origins', async () => {
      const req = {
        headers: { origin: 'https://example.com' },
        method: 'OPTIONS',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/test',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(
        204,
        expect.objectContaining({
          'Access-Control-Allow-Origin': '*',
        }),
      );
    });

    it('should return * for no origin', async () => {
      const req = {
        headers: {},
        method: 'OPTIONS',
        on: vi.fn(),
        setTimeout: vi.fn(),
        url: '/test',
      };
      const res = {
        destroyed: false,
        end: vi.fn(),
        headersSent: false,
        writeHead: vi.fn(),
      };

      await mockServerHandler.current(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(
        204,
        expect.objectContaining({
          'Access-Control-Allow-Origin': '*',
        }),
      );
    });
  });

  describe('getFileServerDomain', () => {
    it('should return correct domain when initialized', async () => {
      mockServer.listen.mockImplementation((_port, _host, cb) => cb());
      await manager.initialize();

      const domain = manager.getFileServerDomain();

      expect(domain).toBe('http://127.0.0.1:33250');
    });

    it('should throw error when not initialized', () => {
      expect(() => manager.getFileServerDomain()).toThrow(
        'StaticFileServerManager not initialized or server not started',
      );
    });
  });

  describe('destroy', () => {
    it('should close server and reset state', async () => {
      mockServer.listen.mockImplementation((_port, _host, cb) => cb());
      await manager.initialize();

      manager.destroy();

      expect(mockServer.close).toHaveBeenCalled();
      expect((manager as any).httpServer).toBeNull();
      expect((manager as any).serverPort).toBe(0);
      expect((manager as any).isInitialized).toBe(false);
    });

    it('should do nothing if not initialized', () => {
      manager.destroy();

      expect(mockServer.close).not.toHaveBeenCalled();
    });
  });
});
