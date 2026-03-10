import { getPort } from 'get-port-please';
import { createServer } from 'node:http';

import { LOCAL_STORAGE_URL_PREFIX } from '@/const/dir';
import FileService from '@/services/fileSrv';
import { createLogger } from '@/utils/logger';

import type { App } from '../App';

const logger = createLogger('core:StaticFileServerManager');

const getAllowedOrigin = (rawOrigin?: string) => {
  if (!rawOrigin) return '*';

  try {
    const url = new URL(rawOrigin);
    const normalizedOrigin = `${url.protocol}//${url.host}`;
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? normalizedOrigin : '*';
  } catch {
    const normalizedOrigin = rawOrigin.replace(/\/$/, '');
    return normalizedOrigin.includes('localhost') || normalizedOrigin.includes('127.0.0.1')
      ? normalizedOrigin
      : '*';
  }
};

export class StaticFileServerManager {
  private fileService: FileService;
  private httpServer: any = null;
  private serverPort: number = 0;
  private isInitialized = false;

  constructor(app: App) {
    this.fileService = app.getService(FileService);
    logger.debug('StaticFileServerManager initialized');
  }

  /**
   * Initialize the static file manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('StaticFileServerManager already initialized');
      return;
    }

    logger.info('Initializing StaticFileServerManager');

    try {
      // Start the HTTP file server
      await this.startHttpServer();

      this.isInitialized = true;
      logger.info(
        `StaticFileServerManager initialization completed, server running on port ${this.serverPort}`,
      );
    } catch (error) {
      logger.error('Failed to initialize StaticFileServerManager:', error);
      throw error;
    }
  }

  /**
   * Start the HTTP file server
   */
  private async startHttpServer(): Promise<void> {
    try {
      // Use get-port-please to find an available port
      this.serverPort = await getPort({
        // Fallback port
        host: '127.0.0.1',

        port: 33_250,
        // Preferred ports
        ports: [33_251, 33_252, 33_253, 33_254, 33_255],
      });

      logger.debug(`Found available port: ${this.serverPort}`);

      return new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
          // Set request timeout
          req.setTimeout(30_000, () => {
            logger.warn('Request timeout, closing connection');
            if (!res.destroyed && !res.headersSent) {
              res.writeHead(408, { 'Content-Type': 'text/plain' });
              res.end('Request Timeout');
            }
          });

          // Listen for client disconnection
          req.on('close', () => {
            logger.debug('Client disconnected during request processing');
          });

          try {
            await this.handleHttpRequest(req, res);
          } catch (error) {
            logger.error('Unhandled error in HTTP request handler:', error);

            // Attempt to send error response, but ensure it does not cause further errors
            try {
              if (!res.destroyed && !res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
              }
            } catch (responseError) {
              logger.error('Failed to send error response:', responseError);
            }
          }
        });

        // Listen on the specified port
        server.listen(this.serverPort, '127.0.0.1', () => {
          this.httpServer = server;
          logger.info(`HTTP file server started on port ${this.serverPort}`);
          resolve();
        });

        server.on('error', (error) => {
          logger.error('HTTP server error:', error);
          reject(error);
        });
      });
    } catch (error) {
      logger.error('Failed to get available port:', error);
      throw error;
    }
  }

  /**
   * Handle HTTP requests
   */
  private async handleHttpRequest(req: any, res: any): Promise<void> {
    try {
      // Check if the response has already ended
      if (res.destroyed || res.headersSent) {
        logger.warn('Response already ended, skipping request processing');
        return;
      }

      // Get the request Origin and set CORS
      const origin = req.headers.origin || req.headers.referer;
      const allowedOrigin = getAllowedOrigin(origin);

      // Handle CORS preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      const url = new URL(req.url, `http://127.0.0.1:${this.serverPort}`);
      logger.debug(`Processing HTTP file request: ${req.url}`);
      logger.debug(`Request method: ${req.method}`);
      logger.debug(`Request headers: ${JSON.stringify(req.headers)}`);

      // Extract file path: extract the relative path from /desktop-file/path/to/file.png
      let filePath = decodeURIComponent(url.pathname.slice(1)); // Remove the leading /
      logger.debug(`Initial file path after decode: ${filePath}`);

      // If the path starts with desktop-file/, remove that prefix
      const prefixWithoutSlash = LOCAL_STORAGE_URL_PREFIX.slice(1) + '/'; // Remove the leading / and add a trailing /
      logger.debug(`Prefix to remove: ${prefixWithoutSlash}`);

      if (filePath.startsWith(prefixWithoutSlash)) {
        filePath = filePath.slice(prefixWithoutSlash.length);
        logger.debug(`File path after removing prefix: ${filePath}`);
      }

      if (!filePath) {
        logger.warn(`Empty file path in HTTP request: ${req.url}`);
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad Request: Empty file path');
        }
        return;
      }

      // Use FileService to retrieve the file
      const desktopPath = `desktop://${filePath}`;
      logger.debug(`Attempting to get file: ${desktopPath}`);
      const fileResult = await this.fileService.getFile(desktopPath);
      logger.debug(
        `File retrieved successfully, mime type: ${fileResult.mimeType}, size: ${fileResult.content.byteLength} bytes`,
      );

      // Check the response status again
      if (res.destroyed || res.headersSent) {
        logger.warn('Response ended during file processing');
        return;
      }

      // Set response headers
      res.writeHead(200, {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Cache-Control': 'public, max-age=31536000',
        'Content-Length': Buffer.byteLength(fileResult.content),
        'Content-Type': fileResult.mimeType,
      });

      // Send file content
      res.end(Buffer.from(fileResult.content));

      logger.debug(`HTTP file served successfully: desktop://${filePath}`);
    } catch (error) {
      logger.error(`Error serving HTTP file: ${error}`);
      logger.error(`Error stack: ${error.stack}`);

      // Check if the response is still writable
      if (!res.destroyed && !res.headersSent) {
        try {
          // Get the request Origin and set CORS (error responses also need this!)
          const origin = req.headers.origin || req.headers.referer;
          const allowedOrigin = getAllowedOrigin(origin);

          // Determine whether it is a file not found error
          if (error.name === 'FileNotFoundError') {
            res.writeHead(404, {
              'Access-Control-Allow-Origin': allowedOrigin,
              'Content-Type': 'text/plain',
            });
            res.end('File Not Found');
          } else {
            res.writeHead(500, {
              'Access-Control-Allow-Origin': allowedOrigin,
              'Content-Type': 'text/plain',
            });
            res.end('Internal Server Error');
          }
        } catch (writeError) {
          logger.error('Failed to write error response:', writeError);
        }
      } else {
        logger.warn('Cannot write error response: connection already closed');
      }
    }
  }

  /**
   * Get file server domain
   */
  getFileServerDomain(): string {
    if (!this.isInitialized || !this.serverPort) {
      throw new Error('StaticFileServerManager not initialized or server not started');
    }

    const serverDomain = `http://127.0.0.1:${this.serverPort}`;
    return serverDomain;
  }

  /**
   * Destroy the static file manager
   */
  destroy() {
    logger.info('Destroying StaticFileServerManager');

    if (this.httpServer) {
      logger.debug('Closing HTTP file server');
      this.httpServer.close(() => {
        logger.debug('HTTP file server closed');
      });
      this.httpServer = null;
      this.serverPort = 0;
    }

    this.isInitialized = false;
    logger.info('StaticFileServerManager destroyed');
  }
}
