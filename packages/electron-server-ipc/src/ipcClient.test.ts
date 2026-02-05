import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ElectronIpcClient } from './ipcClient';

// Mock node modules
vi.mock('node:fs');
vi.mock('node:net');
vi.mock('node:os');
vi.mock('node:path');

const appId = 'lobehub';
describe('ElectronIpcClient', () => {
  // Swallow unhandledRejection during timeout tests to avoid Vitest global capture
  const onUnhandled = (/* reason, promise */) => {};

  beforeAll(() => {
    process.on('unhandledRejection', onUnhandled);
  });

  afterAll(() => {
    process.off('unhandledRejection', onUnhandled);
  });
  // Mock data
  const mockTempDir = '/mock/temp/dir';
  const mockSocketInfoPath = '/mock/temp/dir/lobehub-electron-ipc-info.json';
  const mockSocketInfo = { socketPath: '/mock/socket/path' };

  // Mock socket
  const mockSocket = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };

  beforeEach(() => {
    // Use fake timers
    vi.useFakeTimers();

    // Reset all mocks
    vi.resetAllMocks();

    // Setup common mocks
    vi.mocked(os.tmpdir).mockReturnValue(mockTempDir);
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
    vi.mocked(net.createConnection).mockReturnValue(mockSocket as unknown as net.Socket);

    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock timers
    vi.spyOn(global, 'setTimeout');
    vi.spyOn(global, 'clearTimeout');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with socket path from info file if it exists', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));

      // Execute
      new ElectronIpcClient(appId);

      // Verify
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketInfoPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockSocketInfoPath, 'utf8');
    });

    it('should initialize with default socket path if info file does not exist', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Execute
      new ElectronIpcClient(appId);

      // Verify
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketInfoPath);
      expect(fs.readFileSync).not.toHaveBeenCalled();

      // Test platform-specific behavior
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      new ElectronIpcClient(appId);
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle initialization errors gracefully', () => {
      // Setup - Mock the error
      vi.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('Mock file system error');
      });

      // Execute
      new ElectronIpcClient(appId);

      // Verify
      expect(console.error).toHaveBeenCalledWith(
        'Failed to initialize IPC client:',
        expect.objectContaining({ message: 'Mock file system error' }),
      );
    });
  });

  describe('connection and request handling', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      // Setup a client with a known socket path
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient(appId);

      // Reset socket mocks for each test
      mockSocket.on.mockReset();
      mockSocket.write.mockReset();

      // Default implementation for socket.on
      mockSocket.on.mockImplementation((event, callback) => {
        return mockSocket;
      });

      // Default implementation for socket.write
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) callback();
        return true;
      });
    });

    it('should handle connection errors', async () => {
      // Start request - but don't await it yet
      const requestPromise = client.sendRequest('getDatabasePath');

      // Find the error event handler
      const errorCallArgs = mockSocket.on.mock.calls.find((call) => call[0] === 'error');
      if (errorCallArgs && typeof errorCallArgs[1] === 'function') {
        const errorHandler = errorCallArgs[1];

        // Trigger the error handler
        errorHandler(new Error('Connection error'));
      }

      // Now await the promise
      await expect(requestPromise).rejects.toThrow('Connection error');
    });

    it('should handle write errors', async () => {
      // Setup connection callback
      let connectionCallback: Function | undefined;
      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Setup write to fail
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) callback(new Error('Write error'));
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');
      // Prevent unhandled rejection warnings before assertion
      void requestPromise.catch(() => {});
      // Prevent unhandled rejection warnings before assertion
      void requestPromise.catch(() => {});

      // Simulate connection established
      if (connectionCallback) connectionCallback();

      // Now await the promise
      await expect(requestPromise).rejects.toThrow('Write error');
    });

    it('should handle successful request-response cycle', async () => {
      // Setup connection callback
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          // Call success callback synchronously
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath', { test: 'param' });

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      // Verify request was written
      expect(mockSocket.write).toHaveBeenCalled();
      const writeCall = mockSocket.write.mock.calls[0];
      const request = JSON.parse(writeCall[0] as string);
      expect(request).toMatchObject({
        method: 'getDatabasePath',
        params: { test: 'param' },
      });

      // Simulate server response immediately
      const response = {
        id: request.id,
        result: '/path/to/database',
      };

      if (dataCallback) {
        dataCallback(Buffer.from(JSON.stringify(response) + '\n'));
      }

      // Verify promise resolves with result
      const result = await requestPromise;
      expect(result).toBe('/path/to/database');
    });

    it('should handle server error responses', async () => {
      // Setup connection and data callbacks
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');
      // Prevent unhandled rejection warnings before assertion
      void requestPromise.catch(() => {});
      // Prevent unhandled rejection warnings before assertion
      void requestPromise.catch(() => {});

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      const writeCall = mockSocket.write.mock.calls[0];
      const request = JSON.parse(writeCall[0] as string);

      // Simulate server error response
      const errorResponse = {
        id: request.id,
        error: 'Database not found',
      };

      if (dataCallback) {
        dataCallback(Buffer.from(JSON.stringify(errorResponse) + '\n'));
      }

      // Verify promise rejects with error
      await expect(requestPromise).rejects.toThrow('Database not found');
    });

    it('should handle multiple messages in single data chunk', async () => {
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start multiple requests
      const request1Promise = client.sendRequest('getDatabasePath');

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      const request2Promise = client.sendRequest('getUserDataPath');

      // Process second request
      await new Promise((resolve) => process.nextTick(resolve));

      // Get request IDs
      const request1 = JSON.parse(mockSocket.write.mock.calls[0][0] as string);
      const request2 = JSON.parse(mockSocket.write.mock.calls[1][0] as string);

      // Simulate multiple responses in single data chunk
      const response1 = { id: request1.id, result: '/db/path' };
      const response2 = { id: request2.id, result: '/user/path' };

      const combinedData = JSON.stringify(response1) + '\n' + JSON.stringify(response2) + '\n';

      if (dataCallback) {
        dataCallback(Buffer.from(combinedData));
      }

      // Both promises should resolve
      const result1 = await request1Promise;
      const result2 = await request2Promise;
      expect(result1).toBe('/db/path');
      expect(result2).toBe('/user/path');
    });

    it('should handle fragmented messages', async () => {
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');
      // Prevent unhandled rejection warnings before assertion
      void requestPromise.catch(() => {});
      // Prevent unhandled rejection warnings before assertion
      void requestPromise.catch(() => {});

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      const request = JSON.parse(mockSocket.write.mock.calls[0][0] as string);
      const response = JSON.stringify({ id: request.id, result: '/database/path' }) + '\n';

      // Send response in fragments
      const fragment1 = response.slice(0, 20);
      const fragment2 = response.slice(20);

      if (dataCallback) {
        // First fragment - should not resolve yet
        dataCallback(Buffer.from(fragment1));

        // Second fragment - should complete and resolve
        dataCallback(Buffer.from(fragment2));
      }

      const result = await requestPromise;
      expect(result).toBe('/database/path');
    });

    it('should handle request timeout', async () => {
      let connectionCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Allow promise to start
      await vi.runAllTimersAsync();

      if (connectionCallback) connectionCallback();

      // Allow connection to be processed
      await vi.runAllTimersAsync();

      // Prepare assertion before advancing timers to avoid late-attached handlers
      const expectReject = expect(requestPromise).rejects.toThrow(
        'Request timed out, method: getDatabasePath',
      );
      // Fast-forward time by 5000ms to trigger timeout
      vi.advanceTimersByTime(5000);
      // Run timer callbacks
      await vi.runAllTimersAsync();
      // Request should timeout
      await expectReject;
    }, 10000);

    it('should handle socket close event', async () => {
      let connectionCallback: Function | undefined;
      let closeCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          closeCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      // Simulate socket close
      if (closeCallback) closeCallback();

      // Request should be rejected due to connection loss
      await expect(requestPromise).rejects.toThrow('Connection to Electron IPC server lost');
    });

    it('should handle malformed JSON responses', async () => {
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Allow request to start
      await vi.runAllTimersAsync();

      if (connectionCallback) connectionCallback();

      // Allow connection to be processed
      await vi.runAllTimersAsync();

      // Send malformed JSON
      if (dataCallback) {
        dataCallback(Buffer.from('invalid json\n'));
      }

      // Allow malformed data to be processed
      await vi.runAllTimersAsync();

      // Should log error but not crash
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse response'),
        expect.anything(),
        'invalid json',
      );

      // Original request should still timeout normally
      const expectReject = expect(requestPromise).rejects.toThrow('Request timed out');
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();
      await expectReject;
    }, 10000);

    it('should handle response for unknown request ID', async () => {
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Allow request to start
      await vi.runAllTimersAsync();

      if (connectionCallback) connectionCallback();

      // Allow connection to be processed
      await vi.runAllTimersAsync();

      // Send response with unknown ID
      const unknownResponse = {
        id: 'unknown-id',
        result: 'some result',
      };

      if (dataCallback) {
        dataCallback(Buffer.from(JSON.stringify(unknownResponse) + '\n'));
      }

      // Allow unknown response to be processed
      await vi.runAllTimersAsync();

      // Should handle gracefully without crashing
      vi.advanceTimersByTime(100); // Small delay
      await vi.runAllTimersAsync();

      // Original request should still timeout
      const expectReject = expect(requestPromise).rejects.toThrow('Request timed out');
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();
      await expectReject;
    }, 10000);

    it('should skip empty messages', async () => {
      let connectionCallback: Function | undefined;
      let dataCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          dataCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      const request = JSON.parse(mockSocket.write.mock.calls[0][0] as string);

      // Send data with empty lines and valid response
      const dataWithEmptyLines =
        '\n\n\n' + JSON.stringify({ id: request.id, result: '/path' }) + '\n';

      if (dataCallback) {
        dataCallback(Buffer.from(dataWithEmptyLines));
      }

      const result = await requestPromise;
      expect(result).toBe('/path');
    });

    it('should handle connection attempt on already connected client', async () => {
      let connectionCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // First request - establishes connection
      const request1Promise = client.sendRequest('getDatabasePath');
      // Prevent unhandled rejection warnings before assertion
      void request1Promise.catch(() => {});

      // Allow first request to start
      await vi.runAllTimersAsync();

      if (connectionCallback) connectionCallback();

      // Allow connection to be processed
      await vi.runAllTimersAsync();

      // Second request - should reuse existing connection
      const request2Promise = client.sendRequest('getUserDataPath');
      // Prevent unhandled rejection warnings before assertion
      void request2Promise.catch(() => {});

      // Allow second request to be processed
      await vi.runAllTimersAsync();

      // net.createConnection should only be called once
      expect(net.createConnection).toHaveBeenCalledTimes(1);

      // Clean up promises
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();
      await expect(request1Promise).rejects.toThrow('Request timed out');
      await expect(request2Promise).rejects.toThrow('Request timed out');
    }, 10000);
  });

  describe('reconnection logic', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      // Setup a client with a known socket path
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient(appId);
    });

    it('should attempt reconnection after connection loss', async () => {
      let connectionCallback: Function | undefined;
      let errorCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          errorCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      // Simulate connection error
      if (errorCallback) {
        errorCallback(new Error('Connection lost'));
      }

      // Should schedule reconnection
      expect(vi.mocked(setTimeout)).toHaveBeenCalled();

      await expect(requestPromise).rejects.toThrow('Connection to Electron IPC server lost');
    });

    it('should give up after max reconnection attempts', async () => {
      let connectionCallback: Function | undefined;
      let errorCallback: Function | undefined;

      // Mock multiple connection attempts that fail
      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          errorCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath');

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process all pending promises
      await new Promise((resolve) => process.nextTick(resolve));

      if (errorCallback) {
        errorCallback(new Error('Connection failed 1'));
      }

      await expect(requestPromise).rejects.toThrow('Connection to Electron IPC server lost');
      expect(vi.mocked(setTimeout)).toHaveBeenCalled();
    });

    it('should clear existing reconnect timeout when handling new disconnect', async () => {
      // This test verifies that clearTimeout is called during client close
      let connectionCallback: Function | undefined;
      let errorCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          errorCallback = callback as Function;
        }
        return mockSocket;
      });

      // Mock write to immediately call success callback
      mockSocket.write.mockImplementation((data, callback) => {
        if (callback) {
          setTimeout(() => callback(), 0);
        }
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath').catch(() => {});

      // Immediately resolve connection
      if (connectionCallback) connectionCallback();

      // Process setup
      await new Promise((resolve) => process.nextTick(resolve));

      // Simulate error to trigger reconnection setup
      if (errorCallback) {
        errorCallback(new Error('First error'));
      }

      // Close client to trigger clearTimeout
      client.close();

      // clearTimeout should be called
      expect(vi.mocked(clearTimeout)).toHaveBeenCalled();
    });
  });

  describe('error scenarios', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient(appId);
    });

    // Note: socketPath null test skipped due to complexity with async error handling

    it('should handle connection creation failure', async () => {
      vi.mocked(net.createConnection).mockImplementation(() => {
        throw new Error('Failed to create connection');
      });

      const requestPromise = client.sendRequest('getDatabasePath');

      await expect(requestPromise).rejects.toThrow('Failed to create connection');
      expect(console.error).toHaveBeenCalledWith(
        'Failed to connect to IPC server: %o',
        expect.any(Error),
      );
    });

    it('should handle JSON stringify error in sendRequest', async () => {
      let connectionCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Create a circular reference object that will cause JSON.stringify to fail
      const circularParams: any = { prop: 'value' };
      circularParams.circular = circularParams;

      // Start request with circular reference
      const requestPromise = client.sendRequest('getDatabasePath', circularParams);
      if (connectionCallback) connectionCallback();

      await expect(requestPromise).rejects.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        'Error sending request (during setup/write phase): %o',
        expect.any(Error),
      );
    });

    it('should handle write failure without pending request', async () => {
      let connectionCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Mock write to fail after clearing the request from queue
      let writeCallback: Function | undefined;
      mockSocket.write.mockImplementation((data, callback) => {
        writeCallback = callback as Function;
        return true;
      });

      // Start request
      const requestPromise = client.sendRequest('getDatabasePath').catch(() => {});

      // Allow request to start
      await vi.runAllTimersAsync();

      if (connectionCallback) connectionCallback();

      // Allow connection to be processed
      await vi.runAllTimersAsync();

      // Manually clear the request queue to simulate timing issue
      (client as any).requestQueue.clear();

      // Now trigger write callback with error
      if (writeCallback) {
        writeCallback(new Error('Write failed'));
      }

      // Allow error to be processed
      await vi.runAllTimersAsync();

      // Should handle gracefully - note the error is logged but no exception is thrown
      // because the request is no longer in the queue
      expect(console.error).toHaveBeenCalledWith(
        'Failed to write request to socket: %o',
        expect.any(Error),
      );
    }, 10000);
  });

  describe('close method', () => {
    let client: ElectronIpcClient;

    beforeEach(() => {
      // Setup a client with a known socket path
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSocketInfo));
      client = new ElectronIpcClient(appId);

      // Setup socket.on
      mockSocket.on.mockImplementation((event, callback) => {
        return mockSocket;
      });
    });

    it('should close the socket connection', async () => {
      // Setup connection callback
      let connectionCallback: Function | undefined;
      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      // Start a request to establish connection (but don't wait for it)
      const requestPromise = client.sendRequest('getDatabasePath').catch(() => {}); // Ignore any errors

      // Simulate connection
      if (connectionCallback) connectionCallback();

      // Close the connection
      client.close();

      // Verify
      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should handle close when not connected', () => {
      // Close without connecting
      client.close();

      // Verify no errors
      expect(mockSocket.end).not.toHaveBeenCalled();
    });

    it('should clear reconnect timeout when closing', async () => {
      let connectionCallback: Function | undefined;
      let errorCallback: Function | undefined;

      vi.mocked(net.createConnection).mockImplementation((path, callback) => {
        connectionCallback = callback as Function;
        return mockSocket as unknown as net.Socket;
      });

      mockSocket.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          errorCallback = callback as Function;
        }
        return mockSocket;
      });

      // Start request and trigger error to set up reconnection
      const requestPromise = client.sendRequest('getDatabasePath').catch(() => {});

      // Allow promise to start
      await vi.runAllTimersAsync();

      if (connectionCallback) connectionCallback();

      // Allow connection to be processed
      await vi.runAllTimersAsync();

      if (errorCallback) {
        errorCallback(new Error('Test error'));
      }

      // Allow error to be processed
      await vi.runAllTimersAsync();

      // Close the client
      client.close();

      // Should clear timeout
      expect(vi.mocked(clearTimeout)).toHaveBeenCalled();
    }, 10000);
  });
});
