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
  private app: App;
  private fileService: FileService;
  private httpServer: any = null;
  private serverPort: number = 0;
  private isInitialized = false;

  constructor(app: App) {
    this.app = app;
    this.fileService = app.getService(FileService);
    logger.debug('StaticFileServerManager initialized');
  }

  /**
   * 初始化静态文件管理器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('StaticFileServerManager already initialized');
      return;
    }

    logger.info('Initializing StaticFileServerManager');

    try {
      // 启动 HTTP 文件服务器
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
   * 启动 HTTP 文件服务器
   */
  private async startHttpServer(): Promise<void> {
    try {
      // 使用 get-port-please 获取可用端口
      this.serverPort = await getPort({
        // 备用端口
        host: '127.0.0.1',

        port: 33_250,
        // 首选端口
        ports: [33_251, 33_252, 33_253, 33_254, 33_255],
      });

      logger.debug(`Found available port: ${this.serverPort}`);

      return new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
          // 设置请求超时
          req.setTimeout(30_000, () => {
            logger.warn('Request timeout, closing connection');
            if (!res.destroyed && !res.headersSent) {
              res.writeHead(408, { 'Content-Type': 'text/plain' });
              res.end('Request Timeout');
            }
          });

          // 监听客户端断开连接
          req.on('close', () => {
            logger.debug('Client disconnected during request processing');
          });

          try {
            await this.handleHttpRequest(req, res);
          } catch (error) {
            logger.error('Unhandled error in HTTP request handler:', error);

            // 尝试发送错误响应，但确保不会导致进一步错误
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

        // 监听指定端口
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
   * 处理 HTTP 请求
   */
  private async handleHttpRequest(req: any, res: any): Promise<void> {
    try {
      // 检查响应是否已经结束
      if (res.destroyed || res.headersSent) {
        logger.warn('Response already ended, skipping request processing');
        return;
      }

      // 获取请求的 Origin 并设置 CORS
      const origin = req.headers.origin || req.headers.referer;
      const allowedOrigin = getAllowedOrigin(origin);

      // 处理 CORS 预检请求
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

      // 提取文件路径：从 /desktop-file/path/to/file.png 中提取相对路径
      let filePath = decodeURIComponent(url.pathname.slice(1)); // 移除开头的 /
      logger.debug(`Initial file path after decode: ${filePath}`);

      // 如果路径以 desktop-file/ 开头，则移除该前缀
      const prefixWithoutSlash = LOCAL_STORAGE_URL_PREFIX.slice(1) + '/'; // 移除开头的 / 并添加结尾的 /
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

      // 使用 FileService 获取文件
      const desktopPath = `desktop://${filePath}`;
      logger.debug(`Attempting to get file: ${desktopPath}`);
      const fileResult = await this.fileService.getFile(desktopPath);
      logger.debug(
        `File retrieved successfully, mime type: ${fileResult.mimeType}, size: ${fileResult.content.byteLength} bytes`,
      );

      // 再次检查响应状态
      if (res.destroyed || res.headersSent) {
        logger.warn('Response ended during file processing');
        return;
      }

      // 设置响应头
      res.writeHead(200, {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Cache-Control': 'public, max-age=31536000',
        'Content-Length': Buffer.byteLength(fileResult.content),
        'Content-Type': fileResult.mimeType,
      });

      // 发送文件内容
      res.end(Buffer.from(fileResult.content));

      logger.debug(`HTTP file served successfully: desktop://${filePath}`);
    } catch (error) {
      logger.error(`Error serving HTTP file: ${error}`);
      logger.error(`Error stack: ${error.stack}`);

      // 检查响应是否仍然可写
      if (!res.destroyed && !res.headersSent) {
        try {
          // 获取请求的 Origin 并设置 CORS（错误响应也需要！）
          const origin = req.headers.origin || req.headers.referer;
          const allowedOrigin = getAllowedOrigin(origin);

          // 判断是否是文件未找到错误
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
   * 获取文件服务器域名
   */
  getFileServerDomain(): string {
    if (!this.isInitialized || !this.serverPort) {
      throw new Error('StaticFileServerManager not initialized or server not started');
    }

    const serverDomain = `http://127.0.0.1:${this.serverPort}`;
    return serverDomain;
  }

  /**
   * 销毁静态文件管理器
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
