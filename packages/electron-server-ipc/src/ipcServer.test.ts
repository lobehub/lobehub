import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronIPCServer } from './ipcServer';

// Mock node modules
vi.mock('node:fs');
vi.mock('node:net');
vi.mock('node:os');
vi.mock('node:path');

const appId = 'lobehub';

describe('ElectronIPCServer', () => {
  // Mock data
  const mockTempDir = '/mock/temp/dir';
  const mockSocketPath = '/mock/temp/dir/lobehub-electron-ipc.sock';
  const mockSocketInfoPath = '/mock/temp/dir/lobehub-electron-ipc-info.json';

  // Mock server and socket
  const mockServer = {
    on: vi.fn(),
    listen: vi.fn(),
    close: vi.fn(),
  };

  const mockSocket = {
    on: vi.fn(),
    write: vi.fn(),
  };

  // Mock event handler
  const mockEventHandler = {
    testMethod: vi.fn(),
    getStaticFilePath: vi.fn(),
  };

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // 使用模拟定时器
    vi.useFakeTimers();

    // Setup common mocks
    vi.mocked(os.tmpdir).mockReturnValue(mockTempDir);
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(net.createServer).mockReturnValue(mockServer as unknown as net.Server);

    // Mock socket path for different platforms
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    // Mock fs functions
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('server initialization and start', () => {
    it('should create server and start listening', async () => {
      // Setup
      mockServer.listen.mockImplementation((path, callback) => {
        callback?.();
        return mockServer;
      });

      // Execute
      const server = new ElectronIPCServer(appId, mockEventHandler as any);
      await server.start();

      // Verify
      expect(net.createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(mockSocketPath, expect.any(Function));
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockSocketInfoPath,
        JSON.stringify({ socketPath: mockSocketPath }),
        'utf8',
      );
    });

    it('should remove existing socket file if it exists', async () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockServer.listen.mockImplementation((path, callback) => {
        callback?.();
        return mockServer;
      });

      // Execute
      const server = new ElectronIPCServer(appId, mockEventHandler as any);

      // Verify
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketPath);
      expect(fs.unlinkSync).toHaveBeenCalledWith(mockSocketPath);
    });

    it('should handle server start error', async () => {
      // Setup
      const mockError = new Error('Server start error');
      mockServer.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          callback(mockError);
        }
        return mockServer;
      });

      // Execute and verify
      const server = new ElectronIPCServer(appId, mockEventHandler as any);
      await expect(server.start()).rejects.toThrow('Server start error');
    });
  });

  describe('connection and message handling', () => {
    let server: ElectronIPCServer;
    let connectionHandler: Function;

    beforeEach(() => {
      // Setup connection handler capture
      mockServer.on.mockReset();
      mockSocket.on.mockReset();
      mockSocket.write.mockReset();

      vi.mocked(net.createServer).mockImplementation((handler) => {
        connectionHandler = handler as any;
        return mockServer as unknown as net.Server;
      });

      mockServer.listen.mockImplementation((path, callback) => {
        callback?.();
        return mockServer;
      });

      // Create server
      server = new ElectronIPCServer(appId, mockEventHandler as any);
    });

    it('should handle client connection and setup data listeners', async () => {
      // Start server
      await server.start();

      // Simulate connection
      connectionHandler(mockSocket);

      // Verify socket listeners setup
      expect(mockSocket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should parse messages with \n separator and execute handler', async () => {
      // Setup mock handler
      mockEventHandler.testMethod.mockResolvedValue('success');

      // Start server
      await server.start();

      // Simulate connection
      connectionHandler(mockSocket);

      // Get data handler
      const dataHandlerCall = mockSocket.on.mock.calls.find((call) => call[0] === 'data');
      expect(dataHandlerCall).toBeDefined();
      const dataHandler = dataHandlerCall![1];

      // Create test message
      const message =
        JSON.stringify({
          id: 'test-id',
          method: 'testMethod',
          params: { key: 'value' },
        }) + '\n';

      // Send message
      await dataHandler(Buffer.from(message));

      // 确保异步处理完成
      await vi.runAllTimersAsync();

      // Verify handler execution
      expect(mockEventHandler.testMethod).toHaveBeenCalledWith(
        { key: 'value' },
        expect.objectContaining({
          id: 'test-id',
          method: 'testMethod',
          socket: mockSocket,
        }),
      );

      // 触发服务器端处理程序执行
      const pendingHandlerPromise = mockEventHandler.testMethod.mock.results[0].value;
      await pendingHandlerPromise;

      // Verify response format with \n\n separator
      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({ id: 'test-id', result: 'success' }) + '\n\n',
      );
    });

    it('should handle multiple messages in single data chunk', async () => {
      // Setup mock handlers with resolved values
      mockEventHandler.testMethod.mockResolvedValue('success1');
      mockEventHandler.getStaticFilePath.mockResolvedValue('path/to/file');

      // Start server
      await server.start();

      // Simulate connection
      connectionHandler(mockSocket);

      // Get data handler
      const dataHandlerCall = mockSocket.on.mock.calls.find((call) => call[0] === 'data');
      expect(dataHandlerCall).toBeDefined();
      const dataHandler = dataHandlerCall![1];

      // Create multiple messages in one chunk
      const message1 =
        JSON.stringify({
          id: 'id1',
          method: 'testMethod',
          params: { key1: 'value1' },
        }) + '\n\n';

      const message2 =
        JSON.stringify({
          id: 'id2',
          method: 'getStaticFilePath',
          params: 'path/param',
        }) + '\n\n';

      // Send combined message
      await dataHandler(Buffer.from(message1 + message2));

      // 确保异步处理完成
      await vi.runAllTimersAsync();

      // Verify both handlers were executed
      expect(mockEventHandler.testMethod).toHaveBeenCalledWith(
        { key1: 'value1' },
        expect.objectContaining({ id: 'id1', method: 'testMethod' }),
      );

      expect(mockEventHandler.getStaticFilePath).toHaveBeenCalledWith(
        'path/param',
        expect.objectContaining({ id: 'id2', method: 'getStaticFilePath' }),
      );

      // 等待处理程序完成
      const promise1 = mockEventHandler.testMethod.mock.results[0].value;
      const promise2 = mockEventHandler.getStaticFilePath.mock.results[0].value;
      await Promise.all([promise1, promise2]);

      // Verify responses
      expect(mockSocket.write).toHaveBeenCalledTimes(2);
      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({ id: 'id1', result: 'success1' }) + '\n\n',
      );
      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({ id: 'id2', result: 'path/to/file' }) + '\n\n',
      );
    });

    it('should handle partial messages and buffer them', async () => {
      // Setup mock handler
      mockEventHandler.testMethod.mockResolvedValue('success');

      // Start server
      await server.start();

      // Simulate connection
      connectionHandler(mockSocket);

      // Get data handler
      const dataHandlerCall = mockSocket.on.mock.calls.find((call) => call[0] === 'data');
      expect(dataHandlerCall).toBeDefined();
      const dataHandler = dataHandlerCall![1];

      // Create partial message (first half)
      const fullMessage =
        JSON.stringify({
          id: 'test-id',
          method: 'testMethod',
          params: { data: 'test' },
        }) + '\n\n';

      const firstHalf = fullMessage.slice(0, 20);
      await dataHandler(Buffer.from(firstHalf));

      // 确保异步处理完成
      await vi.runAllTimersAsync();

      // Verify no handler calls yet
      expect(mockEventHandler.testMethod).not.toHaveBeenCalled();

      // Send second half
      const secondHalf = fullMessage.slice(20);
      await dataHandler(Buffer.from(secondHalf));

      // 确保异步处理完成
      await vi.runAllTimersAsync();

      // Now handler should be called
      expect(mockEventHandler.testMethod).toHaveBeenCalledWith(
        { data: 'test' },
        expect.objectContaining({ id: 'test-id' }),
      );

      // 等待处理程序完成
      const pendingHandlerPromise = mockEventHandler.testMethod.mock.results[0].value;
      await pendingHandlerPromise;

      // 验证响应发送
      expect(mockSocket.write).toHaveBeenCalledWith(
        JSON.stringify({ id: 'test-id', result: 'success' }) + '\n\n',
      );
    });

    it('should handle errors from method handlers', async () => {
      // Setup mock handler to throw error
      const mockError = new Error('Handler error');
      mockEventHandler.testMethod.mockRejectedValue(mockError);

      // Start server
      await server.start();

      // Simulate connection
      connectionHandler(mockSocket);

      // Get data handler
      const dataHandlerCall = mockSocket.on.mock.calls.find((call) => call[0] === 'data');
      expect(dataHandlerCall).toBeDefined();
      const dataHandler = dataHandlerCall![1];

      // Create test message
      const message =
        JSON.stringify({
          id: 'test-id',
          method: 'testMethod',
          params: {},
        }) + '\n\n';

      // Send message
      await dataHandler(Buffer.from(message));

      // 确保异步处理完成
      await vi.runAllTimersAsync();

      // 等待Promise被拒绝
      try {
        const pendingHandlerPromise = mockEventHandler.testMethod.mock.results[0].value;
        await pendingHandlerPromise;
      } catch (error) {
        // 错误预期会被捕获
      }

      // Verify error response
      expect(mockSocket.write).toHaveBeenCalledWith(
        expect.stringContaining(
          '{"error":"Failed to handle method(testMethod): Handler error","id":"test-id"}\n\n',
        ),
      );
    });
  });

  describe('server close', () => {
    it('should close server and clean up socket file', async () => {
      // Setup
      mockServer.listen.mockImplementation((path, callback) => {
        callback?.();
        return mockServer;
      });

      // 明确模拟关闭回调
      mockServer.close.mockImplementation((callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return mockServer;
      });

      // 为非Windows环境设置平台
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      // 模拟文件存在
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Execute
      const server = new ElectronIPCServer(appId, mockEventHandler as any);
      await server.start();

      // 调用关闭方法
      const closePromise = server.close();

      // 运行所有计时器使关闭回调触发
      await vi.runAllTimersAsync();

      // 等待关闭完成
      await closePromise;

      // Verify
      expect(mockServer.close).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith(mockSocketPath);
    });
  });
});
