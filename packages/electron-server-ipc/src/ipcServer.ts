import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import debug from 'debug';

import { SOCK_FILE, SOCK_INFO_FILE, WINDOW_PIPE_FILE } from './const';
import type { ElectronIPCEventHandler } from './types';

const log = debug('electron-server-ipc:server');

export class ElectronIPCServer {
  private server: net.Server;
  private socketPath: string;
  private appId: string;
  private eventHandler: ElectronIPCEventHandler;

  constructor(appId: string, eventHandler: ElectronIPCEventHandler) {
    this.appId = appId;
    const isWindows = process.platform === 'win32';
    // Create unique socket path to avoid conflicts
    this.socketPath = isWindows
      ? WINDOW_PIPE_FILE(appId)
      : path.join(os.tmpdir(), SOCK_FILE(appId));

    // For Unix sockets, ensure the file does not exist
    if (!isWindows && fs.existsSync(this.socketPath)) {
      log('Removing existing socket file at: %s', this.socketPath);
      fs.unlinkSync(this.socketPath);
    }

    // Create server
    log('Creating IPC server');
    this.server = net.createServer(this.handleConnection.bind(this));

    this.eventHandler = eventHandler;
  }

  // Start server
  public start(): Promise<void> {
    log('Starting IPC server');
    return new Promise((resolve, reject) => {
      this.server.on('error', (err) => {
        console.error('IPC Server error: %o', err);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        log('Electron IPC server listening on %s', this.socketPath);

        // Write socket path to temporary file for Next.js server to read
        const tempDir = os.tmpdir();
        const socketInfoPath = path.join(tempDir, SOCK_INFO_FILE(this.appId));
        log('Writing socket info to: %s', socketInfoPath);
        fs.writeFileSync(socketInfoPath, JSON.stringify({ socketPath: this.socketPath }), 'utf8');

        resolve();
      });
    });
  }

  // Handle client connection
  private handleConnection(socket: net.Socket): void {
    let dataBuffer = '';
    log('New client connection established');

    socket.on('data', (data) => {
      const chunk = data.toString();
      log('Received data chunk, size: %d bytes', chunk.length);
      dataBuffer += chunk;

      // Split messages by \n\n
      const messages = dataBuffer.split('\n');
      // Keep the last potentially incomplete message
      dataBuffer = messages.pop() || '';

      // Process each complete message
      for (const message of messages) {
        if (!message.trim()) continue;

        try {
          const parsedMessage = JSON.parse(message);
          log('Successfully parsed JSON message: %o', {
            id: parsedMessage.id,
            method: parsedMessage.method,
          });
          this.handleRequest(socket, parsedMessage);
        } catch (err) {
          console.error('Failed to parse message: %s', err);
        }
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error: %o', err);
    });

    socket.on('close', () => {
      log('Client connection closed');
    });
  }

  // Handle client request
  private handleRequest = async (socket: net.Socket, request: any) => {
    const { id, method, params } = request;
    log('Handling request: %s (ID: %s)', method, id);

    // Execute corresponding operation based on request method
    const eventHandler = this.eventHandler[method];
    if (!eventHandler) {
      console.error('No handler found for method: %s', method);
      return;
    }

    try {
      log('Executing handler for method: %s with params: %o', method, params);
      const data = await eventHandler(params, { id, method, socket });
      log('Handler execution successful for method: %s', method);

      this.sendResult(socket, id, data);
    } catch (err) {
      const errorMsg = `Failed to handle method(${method}): ${(err as Error).message}`;
      console.error('Error handling request: %s', errorMsg);
      this.sendError(socket, id, errorMsg);
    }
  };

  // Send result
  private sendResult(socket: net.Socket, id: string, result: any): void {
    const response = JSON.stringify({ id, result }) + '\n\n';
    log('Sending success response for ID: %s, size: %d bytes', id, response.length);
    socket.write(response);
  }

  // Send error
  private sendError(socket: net.Socket, id: string, error: string): void {
    const response = JSON.stringify({ error, id }) + '\n\n';
    log('Sending error response for ID: %s: %s', id, error);
    socket.write(response);
  }

  // Close server
  public close(): Promise<void> {
    log('Closing IPC server');
    return new Promise((resolve) => {
      this.server.close(() => {
        log('Electron IPC server closed');

        // Delete socket file (Unix platforms)
        if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
          log('Removing socket file: %s', this.socketPath);
          fs.unlinkSync(this.socketPath);
        }

        resolve();
      });
    });
  }
}
