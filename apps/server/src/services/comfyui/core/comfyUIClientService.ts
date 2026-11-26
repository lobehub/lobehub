/**
 * ComfyUI Client Service
 *
 * Central service layer for all ComfyUI SDK interactions
 * Provides unified error handling and abstraction over SDK
 * Uses modular services for authentication, connection, and caching
 */
import { assertSsrfSafeUrl, ssrfSafeAgent, ssrfSafeFetch } from '@lobechat/ssrf-safe-fetch';
import { type ComfyUIKeyVault } from '@lobechat/types';
import {
  type BasicCredentials,
  type BearerTokenCredentials,
  type CustomCredentials,
  type FetchOptions,
  type PromptBuilder,
  type WebSocketInterface,
} from '@saintno/comfyui-sdk';
import { CallWrapper, ComfyApi } from '@saintno/comfyui-sdk';
import debug from 'debug';
import WebSocket, { type ClientOptions } from 'ws';

import { COMFYUI_DEFAULTS } from '@/server/services/comfyui/config/constants';
import { ComfyUIAuthService } from '@/server/services/comfyui/core/comfyUIAuthService';
import { ComfyUIConnectionService } from '@/server/services/comfyui/core/comfyUIConnectionService';
import { ErrorHandlerService } from '@/server/services/comfyui/core/errorHandlerService';
import { ServicesError } from '@/server/services/comfyui/errors';
import { TTLCacheManager } from '@/server/services/comfyui/utils/cacheManager';

const log = debug('lobe-image:comfyui:client');

/**
 * WebSocket transport for the ComfyUI SDK that applies the SSRF policy at
 * connect time: `ws` runs its handshake through the supplied agent, and the
 * request-filtering agent checks the host on every connect.
 */
class SsrfSafeComfyUIWebSocket extends WebSocket {
  constructor(
    url: string | URL,
    protocolsOrOptions?: string | string[] | ClientOptions,
    options?: ClientOptions,
  ) {
    const agent = ssrfSafeAgent(String(url));
    if (
      protocolsOrOptions &&
      typeof protocolsOrOptions === 'object' &&
      !Array.isArray(protocolsOrOptions)
    ) {
      super(url, { ...protocolsOrOptions, agent } as ClientOptions);
    } else {
      super(url, protocolsOrOptions, { ...options, agent });
    }
  }
}

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
  private client?: ComfyApi;
  private baseURL: string;
  /**
   * Resolves once the ComfyUI `baseURL` has passed the SSRF policy and the SDK
   * client exists. The baseURL is user-configurable, so nothing may reach the
   * SDK — its internal `fetchApi` calls do not go through `ssrfSafeFetch` —
   * until the host is checked (T-07). The WebSocket transport is additionally
   * guarded at connect time by {@link SsrfSafeComfyUIWebSocket}.
   */
  private readonly clientReady!: Promise<ComfyApi>;

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

      // Create the SDK client only after the baseURL passes the SSRF policy.
      this.clientReady = assertSsrfSafeUrl(this.baseURL).then(() => {
        this.client = new ComfyApi(this.baseURL, undefined, {
          // Credentials are applied by hardenComfyApi, not here: the constructor
          // would fire testCredentials() synchronously, ahead of the fetchApi
          // patch, and that probe would reach the network unfiltered.
          // The SDK types the impl against the DOM WebSocket, but only uses the
          // members `ws` implements (onopen/onclose/onmessage/onerror, send,
          // close, readyState, ready-state constants).
          customWebSocketImpl: SsrfSafeComfyUIWebSocket as unknown as WebSocketInterface,
        });
        this.hardenComfyApi(this.client, this.authService.getCredentials());
        this.client.init();
        return this.client;
      });

      // Callers observe the rejection when they await clientReady; this branch
      // only keeps an unused service from producing an unhandled rejection.
      this.clientReady.catch((error) => {
        log('❌ ComfyUI client initialization failed:', error);
      });

      log('✅ ComfyUI Client Service initialized with baseURL:', this.baseURL);
    } catch (error) {
      // Use ErrorHandlerService to transform internal errors to framework errors
      this.errorHandler.handleError(error);
    }
  }

  /**
   * Route the SDK's HTTP traffic through the SSRF policy (T-07).
   *
   * Every SDK HTTP call funnels through `fetchApi` → global `fetch`. The
   * constructor-time `assertSsrfSafeUrl` check cannot cover what happens once
   * it has passed: a hostile ComfyUI endpoint (the baseURL is user-supplied)
   * can answer any request with a redirect to an internal address, which the
   * runtime fetch follows unchecked, and a hostname can re-resolve to a
   * private address after the check (DNS rebinding). `fetchApi` is
   * re-implemented 1:1 — credential headers plus `mode: 'cors'` — on top of
   * `ssrfSafeFetch`, so every connect, including redirect hops, is filtered.
   */
  private hardenComfyApi(
    client: ComfyApi,
    credentials: BasicCredentials | BearerTokenCredentials | CustomCredentials | undefined,
  ): void {
    const api = client as unknown as {
      apiURL: (route: string) => string;
      credentials: typeof credentials;
      getCredentialHeaders: () => Record<string, string>;
      testCredentials?: () => Promise<boolean>;
    };

    client.fetchApi = async (route: string, options?: FetchOptions): Promise<Response> => {
      // Same init the SDK builds: credential headers, `mode: 'cors'`.
      const init: FetchOptions = {
        ...options,
        headers: { ...api.getCredentialHeaders() },
        mode: 'cors',
      };
      return ssrfSafeFetch(api.apiURL(route), init);
    };

    api.credentials = credentials;
    void api.testCredentials?.();
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
    if (!this.client) {
      throw new ServicesError(
        'ComfyUI client is not initialized',
        ServicesError.Reasons.CONNECTION_FAILED,
      );
    }
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

    const client = await this.clientReady;
    const result = await client.uploadImage(file, fileName);

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

    const client = await this.clientReady;

    return new Promise<WorkflowResult>((resolve, reject) => {
      new CallWrapper(client, workflow)
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
    const client = await this.clientReady;
    return await this.cacheManager.get('checkpoints', async () => {
      return await client.getCheckpoints();
    });
  }

  /**
   * Get available LoRAs from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   * Uses unified TTL cache for performance optimization
   */
  async getLoras(): Promise<string[]> {
    const client = await this.clientReady;
    return await this.cacheManager.get('loras', async () => {
      return await client.getLoras();
    });
  }

  /**
   * Get node definitions from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   * Uses unified TTL cache for performance optimization
   * @param nodeName - Optional specific node name to query
   */
  async getNodeDefs(nodeName?: string): Promise<any> {
    const client = await this.clientReady;
    const allNodeDefs = await this.cacheManager.get('nodeDefs', async () => {
      return await client.getNodeDefs();
    });

    // Return specific node or all nodes
    return nodeName && allNodeDefs ? { [nodeName]: allNodeDefs[nodeName] } : allNodeDefs;
  }

  /**
   * Get sampler info from ComfyUI
   * Wraps SDK method to avoid Law of Demeter violation
   */
  async getSamplerInfo(): Promise<{ samplerName: string[]; scheduler: string[] }> {
    const client = await this.clientReady;
    const info = await client.getSamplerInfo();

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
