/**
 * ComfyUI Client Service
 *
 * Central service layer for all ComfyUI SDK interactions
 * Provides unified error handling and abstraction over SDK
 * Uses modular services for authentication, connection, and caching
 */
import type { ComfyUIKeyVault } from '@lobechat/types';
import { CallWrapper, ComfyApi, PromptBuilder } from '@saintno/comfyui-sdk';
import debug from 'debug';

import { COMFYUI_DEFAULTS } from '@/server/services/comfyui/config/constants';
import { ComfyUIAuthService } from '@/server/services/comfyui/core/comfyUIAuthService';
import { ComfyUIConnectionService } from '@/server/services/comfyui/core/comfyUIConnectionService';
import { ErrorHandlerService } from '@/server/services/comfyui/core/errorHandlerService';
import { ServicesError } from '@/server/services/comfyui/errors';
import { TTLCacheManager } from '@/server/services/comfyui/utils/cacheManager';

const log = debug('lobe-image:comfyui:client');

/**
 * Workflow execution result
 */
export interface WorkflowResult {
  // Raw output data from workflow execution, keyed by node ID
  _raw?: Record<string, any>;
  images?: {
    images?: Array<{
      data: string;
      height?: number;
      mimeType: string;
      width?: number;
    }>;
  };
}

/**
 * Progress callback type
 */
export type ProgressCallback = (info: any) => void;

/**
 * ComfyUI Client Service
 * Encapsulates all SDK interactions using modular services
 */
export class ComfyUIClientService {
  private client: ComfyApi;
  private baseURL: string;

  // Modular services for separation of concerns
  private cacheManager: TTLCacheManager;
  private authService: ComfyUIAuthService;
  private connectionService: ComfyUIConnectionService;
  private errorHandler: ErrorHandlerService;

  constructor(options: ComfyUIKeyVault = {}) {
    log('🏗️ Initializing ComfyUI Client Service');

    this.errorHandler = new ErrorHandlerService();

    try {
      // Initialize modular services
      this.authService = new ComfyUIAuthService(options);
      this.cacheManager = new TTLCacheManager(60_000); // 1 minute TTL
      this.connectionService = new ComfyUIConnectionService();

      // Setup base URL
      this.baseURL =
        options.baseURL || process.env.COMFYUI_DEFAULT_URL || COMFYUI_DEFAULTS.BASE_URL;

      // Initialize client with credentials from AuthService
      this.client = new ComfyApi(this.baseURL, undefined, {
        credentials: this.authService.getCredentials(),
      });
      this.client.init();

      log('✅ ComfyUI Client Service initialized with baseURL:', this.baseURL);
    } catch (error) {
      // Use ErrorHandlerService to transform internal errors to framework errors
      this.errorHandler.handleError(error);
    }
  }

  /**
   * Get authentication headers for image download
   * This method provides auth headers to framework layer without exposing credentials
   * @returns Authentication headers object, or undefined if no auth is configured
   */
  getAuthHeaders(): Record<string, string> | undefined {
    // Delegate to AuthService
    return this.authService.getAuthHeaders();
  }

  /**
   * Get the path for an image result
   */
  getPathImage(imageInfo: any): string {
    return this.client.getPathImage(imageInfo);
  }

  /**
   * Upload an image to ComfyUI server
   * @param file - The image data as Buffer or Blob
   * @param fileName - The name for the uploaded file
   * @returns The filename on ComfyUI server
   */
  async uploadImage(file: Buffer | Blob, fileName: string): Promise<string> {
    log('📤 Uploading image to ComfyUI:', fileName);

    const result = await this.client.uploadImage(file, fileName);

    if (!result) {
      throw new ServicesError(
        'Failed to upload image to ComfyUI server',
        ServicesError.Reasons.UPLOAD_FAILED,
        { fileName, response: result },
      );
    }

    log('✅ Image uploaded successfully:', result.info.filename);
    return result.info.filename;
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflow: PromptBuilder<any, any, any>,
    onProgress?: ProgressCallback,
  ): Promise<WorkflowResult> {
    log('🚀 Executing workflow...');

    return new Promise<WorkflowResult>((resolve, reject) => {
      new CallWrapper(this.client, workflow)
        .onFinished((result: any) => {
          log('✅ Workflow execution finished successfully');
          log('🔍 Raw workflow result structure:', {
            hasImages: 'images' in result,
            hasRaw: '_raw' in result,
            keys: Object.keys(result),
            rawKeys: result._raw ? Object.keys(result._raw) : null,
          });
          resolve(result);
        })
        .onFailed((error: any) => {
          log('❌ Workflow execution failed:', error?.message || error);
          reject(error);
        })
        .onProgress((info: any) => {
          log('⏳ Progress:', info);
          onProgress?.(info);
        })
        .run();
    });
  }

  /**
   * Get available checkpoints from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   * Uses unified TTL cache for performance optimization
   */
  async getCheckpoints(): Promise<string[]> {
    return await this.cacheManager.get('checkpoints', async () => {
      return await this.client.getCheckpoints();
    });
  }

  /**
   * Get available LoRAs from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   * Uses unified TTL cache for performance optimization
   */
  async getLoras(): Promise<string[]> {
    return await this.cacheManager.get('loras', async () => {
      return await this.client.getLoras();
    });
  }

  /**
   * Get node definitions from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   * Uses unified TTL cache for performance optimization
   * @param nodeName - Optional specific node name to query
   */
  async getNodeDefs(nodeName?: string): Promise<any> {
    const allNodeDefs = await this.cacheManager.get('nodeDefs', async () => {
      return await this.client.getNodeDefs();
    });

    // Return specific node or all nodes
    return nodeName && allNodeDefs ? { [nodeName]: allNodeDefs[nodeName] } : allNodeDefs;
  }

  /**
   * Get sampler info from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   */
  async getSamplerInfo(): Promise<{ samplerName: string[]; scheduler: string[] }> {
    const info = await this.client.getSamplerInfo();

    return {
      samplerName: this.extractStrings(info.sampler),
      scheduler: this.extractStrings(info.scheduler),
    };
  }

  /**
   * Extract string values from sampler info arrays
   * Handle both string arrays and tuple arrays like ['euler', { tooltip: 'info' }]
   */
  private extractStrings(arr: any): string[] {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => (Array.isArray(item) ? item[0] : item))
      .filter((item) => typeof item === 'string');
  }

  /**
   * Validate connection to ComfyUI server
   * Delegates to ConnectionService for connection management
   */
  async validateConnection(): Promise<boolean> {
    return await this.connectionService.validateConnection(
      this.baseURL,
      this.authService.getAuthHeaders(),
    );
  }

  /**
   * Get connection status information
   */
  getConnectionStatus() {
    return this.connectionService.getStatus();
  }

  /**
   * Get authentication service instance (for advanced usage)
   */
  getAuthService(): ComfyUIAuthService {
    return this.authService;
  }

  /**
   * Get connection service instance (for advanced usage)
   */
  getConnectionService(): ComfyUIConnectionService {
    return this.connectionService;
  }
}
