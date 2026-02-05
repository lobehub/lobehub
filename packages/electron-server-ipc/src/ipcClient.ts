import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import debug from 'debug';

import { SOCK_FILE, SOCK_INFO_FILE, WINDOW_PIPE_FILE } from './const';

const log = debug('electron-server-ipc:client');

export class ElectronIpcClient {
  private socketPath: string | null = null;
  private connected: boolean = false;
  private socket: net.Socket | null = null;
  // eslint-disable-next-line @typescript-eslint/ban-types
  private requestQueue: Map<string, { reject: Function; resolve: Function }> = new Map();

  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionAttempts: number = 0;
  private maxConnectionAttempts: number = 5;
  private dataBuffer: string = '';
  private readonly appId: string;

  constructor(appId: string) {
    log('Initializing client', appId);
    this.appId = appId;
    this.initialize();
  }

  // Initialize client
  private initialize() {
    try {
      const tempDir = os.tmpdir();

      // Force use of named pipe on Windows platform
      if (process.platform === 'win32') {
        this.socketPath = WINDOW_PIPE_FILE(this.appId);
        log('Using named pipe for Windows: %s', this.socketPath);
        return;
      }

      // Try to read sock info file on other platforms
      const socketInfoPath = path.join(tempDir, SOCK_INFO_FILE(this.appId));

      log('Looking for socket info at: %s', socketInfoPath);
      if (fs.existsSync(socketInfoPath)) {
        const socketInfo = JSON.parse(fs.readFileSync(socketInfoPath, 'utf8'));
        this.socketPath = socketInfo.socketPath;
        log('Found socket path: %s', this.socketPath);
      } else {
        // If socket information is not found, use default sock file path
        this.socketPath = path.join(tempDir, SOCK_FILE(this.appId));
        log('Socket info not found, using default sock path: %s', this.socketPath);
      }
    } catch (err) {
      console.error('Failed to initialize IPC client:', err);
      this.socketPath = null;
    }
  }

  // Connect to Electron IPC server
  private connect(): Promise<void> {
    if (this.connected || !this.socketPath) {
      log('Connection skipped: Connected=%s, SocketPath=%s', this.connected, !!this.socketPath);
      return Promise.resolve();
    }

    log('Attempting to connect to socket: %s', this.socketPath);
    return new Promise((resolve, reject) => {
      try {
        this.socket = net.createConnection(this.socketPath!, () => {
          this.connected = true;
          this.connectionAttempts = 0;
          log('Connected to Electron IPC server');
          resolve();
        });

        this.socket.on('data', (data) => {
          const dataStr = data.toString();
          log('Received data: %s', dataStr.length > 100 ? `${dataStr.slice(0, 100)}...` : dataStr);

          // Add new data to buffer
          this.dataBuffer += dataStr;

          // Split messages by newline
          const messages = this.dataBuffer.split('\n');

          // The last element may be an incomplete message, keep it in buffer
          this.dataBuffer = messages.pop() || '';
          log('Buffer remainder: %d bytes', this.dataBuffer.length);

          for (const message of messages) {
            if (!message.trim()) continue; // Skip empty messages

            try {
              const response = JSON.parse(message);
              const { id, result, error } = response;
              log('Parsed response for request ID: %s, has error: %s', id, !!error);

              const pending = this.requestQueue.get(id);
              if (pending) {
                log('Found pending request for ID: %s', id);
                this.requestQueue.delete(id);
                if (error) {
                  console.error('Error in response for ID %s: %s', id, error);
                  pending.reject(new Error(error));
                } else {
                  log('Resolving request ID: %s', id);
                  pending.resolve(result);
                }
              } else {
                log('No pending request found for ID: %s', id);
              }
            } catch (err) {
              console.error('Failed to parse response: %o, message: %s', err, message);
            }
          }
        });

        this.socket.on('error', (err) => {
          console.error('Socket error: %o', err);
          this.connected = false;
          this.handleDisconnect();
          reject(err);
        });

        this.socket.on('close', () => {
          log('Socket closed');
          this.connected = false;
          this.handleDisconnect();
        });
      } catch (err) {
        console.error('Failed to connect to IPC server: %o', err);
        this.handleDisconnect();
        reject(err);
      }
    });
  }

  // Handle disconnection
  private handleDisconnect() {
    log('Handling disconnect, connection attempts: %d', this.connectionAttempts);
    // Clear reconnection timer
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
      log('Cleared reconnect timeout');
    }

    // Clear data buffer
    this.dataBuffer = '';

    // Reject all pending requests
    const pendingCount = this.requestQueue.size;
    log('Rejecting %d pending requests', pendingCount);
    for (const [id, { reject }] of this.requestQueue) {
      log('Rejecting request ID: %s', id);
      reject(new Error('Connection to Electron IPC server lost'));
    }
    this.requestQueue.clear();

    // Attempt to reconnect
    if (this.connectionAttempts < this.maxConnectionAttempts) {
      this.connectionAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts - 1), 30_000);
      log('Scheduling reconnection attempt %d in %dms', this.connectionAttempts, delay);

      this.reconnectTimeout = setTimeout(() => {
        log('Attempting reconnection #%d', this.connectionAttempts);
        this.connect().catch((err) => {
          console.error('Reconnection attempt %d failed: %o', this.connectionAttempts, err);
        });
      }, delay);
    } else {
      log('Reached maximum connection attempts, giving up');
    }
  }

  // Send request to Electron IPC server
  public async sendRequest<T>(method: string, params: any = {}): Promise<T> {
    if (!this.socketPath) {
      console.error('Cannot send request: Electron IPC connection not available');
      throw new Error('Electron IPC connection not available');
    }

    // Connect first if not connected
    if (!this.connected) {
      log('Not connected, connecting before sending request');
      await this.connect();
    }

    log('Sending request: %s %o', method, params);
    return new Promise<T>((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 15);
      const request = { id, method, params };
      log('Created request with ID: %s', id);

      let requestTimeoutId: NodeJS.Timeout;

      const cleanupAndResolve = (value: T) => {
        clearTimeout(requestTimeoutId);
        this.requestQueue.delete(id);
        resolve(value);
      };

      const cleanupAndReject = (error: any) => {
        clearTimeout(requestTimeoutId);
        this.requestQueue.delete(id);
        // Keep console.error log for timeout errors
        if (
          error &&
          error.message &&
          typeof error.message === 'string' &&
          error.message.startsWith('Request timed out')
        ) {
          console.error('Request timed out, ID: %s, method: %s', id, method);
        }
        reject(error);
      };

      this.requestQueue.set(id, { reject: cleanupAndReject, resolve: cleanupAndResolve });
      log('Added request to queue, current queue size: %d', this.requestQueue.size);

      requestTimeoutId = setTimeout(() => {
        const pendingRequest = this.requestQueue.get(id);
        if (pendingRequest) {
          // Request is still in queue, indicating timeout
          // Call its dedicated reject handler (cleanupAndReject)
          const errorMsg = `Request timed out, method: ${method}`;
          // console.error is handled in cleanupAndReject
          pendingRequest.reject(new Error(errorMsg));
        }
        // If pendingRequest does not exist, the request has been processed and its timeout has been cleared
      }, 5000);

      try {
        // Send request
        const requestJson = JSON.stringify(request) + '\n';
        log('Writing request to socket, size: %d bytes', requestJson.length);
        this.socket!.write(requestJson, (err) => {
          if (err) {
            // Write failed, request should be treated as failed
            // Call its reject handler (cleanupAndReject)
            const pending = this.requestQueue.get(id);
            if (pending) {
              pending.reject(err); // This will call cleanupAndReject
            } else {
              // This should not happen in theory, as write failures are usually quick
              // But for safety, ensure the original promise is rejected
              cleanupAndReject(err);
            }
            console.error('Failed to write request to socket: %o', err);
          } else {
            log('Request successfully written to socket, ID: %s', id);
          }
        });
      } catch (err) {
        console.error('Error sending request (during setup/write phase): %o', err);
        // Error occurring here means the request didn't even have a chance to enter the queue or set timeout
        // Call cleanupAndReject directly to ensure consistency, although requestTimeoutId may be undefined at this point
        // (clearTimeout(undefined) is safe)
        cleanupAndReject(err);
      }
    });
  }

  // Close connection
  public close() {
    log('Closing client connection');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
      log('Cleared reconnect timeout');
    }

    if (this.socket) {
      log('Ending socket connection');
      this.socket.end();
      this.socket = null;
    }

    this.connected = false;
    log('Client connection closed');
  }
}
