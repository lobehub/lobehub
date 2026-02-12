import Replicate from 'replicate';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type {
  ChatCompletionErrorPayload,
  ChatMethodOptions,
  ChatStreamPayload,
  CreateImagePayload,
} from '../../types';
import { AgentRuntimeErrorType } from '../../types/error';
import { AgentRuntimeError } from '../../utils/createError';
import { desensitizeUrl } from '../../utils/desensitizeUrl';
import { MODEL_LIST_CONFIGS, processModelList } from '../../utils/modelParse';

const DEFAULT_BASE_URL = 'https://api.replicate.com';

interface ReplicateAIParams {
  apiKey?: string;
  baseURL?: string;
  id?: string;
}

export class LobeReplicateAI implements LobeRuntimeAI {
  private client: Replicate;

  baseURL: string;
  apiKey?: string;
  private id: string;

  constructor({ apiKey, baseURL = DEFAULT_BASE_URL, id }: ReplicateAIParams = {}) {
    if (!apiKey) {
      throw AgentRuntimeError.createError(AgentRuntimeErrorType.InvalidProviderAPIKey);
    }

    this.client = new Replicate({
      auth: apiKey,
      baseUrl: baseURL !== DEFAULT_BASE_URL ? baseURL : undefined,
      useFileOutput: false, // Return URLs instead of binary data
    });

    this.baseURL = baseURL;
    this.apiKey = apiKey;
    this.id = id || 'replicate';
  }

  /**
   * Connectivity check for Replicate (non-chat provider)
   * We verify the model exists and stream a minimal SSE "text" event so the checker UI can pass.
   */
  async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
    const modelId = payload.model;

    try {
      if (!modelId || typeof modelId !== 'string' || !modelId.includes('/')) {
        throw new Error('Invalid model id for Replicate connectivity check');
      }

      const [owner, ...nameParts] = modelId.split('/');
      const nameWithVersion = nameParts.join('/');
      const [name] = nameWithVersion.split(':'); // drop :version if present

      // Fast auth + existence check via SDK; no inference cost
      await this.client.models.get(owner, name, { signal: options?.signal });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const textPayload = JSON.stringify(`Replicate connectivity ok for ${modelId}`);
          const stopPayload = JSON.stringify('stop');
          controller.enqueue(encoder.encode(`event: text\ndata: ${textPayload}\n\n`));
          controller.enqueue(encoder.encode(`event: stop\ndata: ${stopPayload}\n\n`));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
        },
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Image generation support for LobeChat async image generation (FLUX, Stable Diffusion, etc.)
   */
  async createImage(payload: CreateImagePayload) {
    try {
      const { model, params } = payload;
      const { prompt, width, height, cfg, steps, seed, imageUrl, aspectRatio } = params;

      this.debugLog('[Replicate createImage] === START ===');
      this.debugLog('[Replicate createImage] Model:', model);
      this.debugLog('[Replicate createImage] Params received:', JSON.stringify(params, null, 2));

      const input: Record<string, any> = {};

      // Redux models don't use prompt - they only use the input image
      if (!model.includes('redux')) {
        input.prompt = prompt;
        this.debugLog('[Replicate createImage] Added prompt:', prompt);
      } else {
        this.debugLog('[Replicate createImage] Skipping prompt (Redux model)');
      }

      // Handle image-to-image models
      if (imageUrl) {
        this.debugLog('[Replicate createImage] imageUrl provided:', imageUrl);

        // Determine the parameter name based on model type
        let imageParamName: string;
        if (model.includes('redux')) {
          imageParamName = 'redux_image';
          this.debugLog('[Replicate createImage] Will map to redux_image');
        } else if (model.includes('canny') || model.includes('depth')) {
          imageParamName = 'control_image';
          this.debugLog('[Replicate createImage] Will map to control_image');
        } else if (model.includes('fill')) {
          imageParamName = 'image';
          this.debugLog('[Replicate createImage] Will map to image (fill)');
        } else {
          imageParamName = 'image';
          this.debugLog('[Replicate createImage] Will map to image (generic)');
        }

        // Check if URL is accessible from internet or local
        // Parse via URL and classify by hostname so it works for any scheme (http, https, etc.)
        let isLocalUrl = false;
        try {
          const parsedUrl = new URL(imageUrl);
          const hostname = parsedUrl.hostname;

          const isLoopbackHost =
            hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

          const isPrivate10Range = hostname.startsWith('10.');
          const isPrivate192Range = hostname.startsWith('192.168.');

          // 172.16.0.0 – 172.31.255.255
          const isPrivate172Range = /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

          const isLocalTld = hostname.endsWith('.local');

          isLocalUrl =
            isLoopbackHost ||
            isPrivate10Range ||
            isPrivate172Range ||
            isPrivate192Range ||
            isLocalTld;
        } catch {
          // If the URL cannot be parsed as an absolute URL, treat it as local/untrusted
          // to ensure we take the SSRF-safe path.
          isLocalUrl = true;
        }

        if (isLocalUrl) {
          this.debugLog(
            '[Replicate createImage] Local URL detected, will fetch and upload as data',
          );
          try {
            const { ssrfSafeFetch } = await import('@lobechat/ssrf-safe-fetch');
            const imageResponse = await ssrfSafeFetch(imageUrl);
            if (!imageResponse.ok) {
              throw new Error(
                `Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`,
              );
            }

            // Get image as buffer
            const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
            this.debugLog(
              '[Replicate createImage] Fetched image, size:',
              imageBuffer.length,
              'bytes',
            );

            // Check size limit (100MB)
            if (imageBuffer.length > 100 * 1024 * 1024) {
              throw new Error(`Image too large: ${imageBuffer.length} bytes (max 100MB)`);
            }

            // Replicate SDK accepts Buffer objects directly
            input[imageParamName] = imageBuffer;
            this.debugLog('[Replicate createImage] Mapped to', imageParamName, 'as Buffer');
          } catch (fetchError: any) {
            this.debugLog('[Replicate createImage] Error fetching local image:', fetchError);
            throw new Error(`Failed to fetch local image: ${fetchError.message}`);
          }
        } else {
          // Public URL - use directly
          input[imageParamName] = imageUrl;
          this.debugLog('[Replicate createImage] Public URL, mapped directly to', imageParamName);
        }
      } else {
        this.debugLog('[Replicate createImage] No imageUrl provided');
      }

      // Map LobeChat params to Replicate params
      if (width && height) {
        input.width = width;
        input.height = height;
        this.debugLog('[Replicate createImage] Set dimensions:', width, 'x', height);
      }

      // For FLUX models, convert to aspect_ratio
      if (model.includes('flux')) {
        // Use explicit aspectRatio if provided (for Redux models)
        if (aspectRatio) {
          input.aspect_ratio = aspectRatio;
          this.debugLog('[Replicate createImage] Set aspect_ratio from param:', aspectRatio);
        } else if (width && height) {
          if (width === height) {
            input.aspect_ratio = '1:1';
          } else if (width === 1280 && height === 720) {
            input.aspect_ratio = '16:9';
          } else if (width === 720 && height === 1280) {
            input.aspect_ratio = '9:16';
          } else if (width > height) {
            input.aspect_ratio = '16:9';
          } else {
            input.aspect_ratio = '9:16';
          }
          this.debugLog('[Replicate createImage] Calculated aspect_ratio:', input.aspect_ratio);
        }
        // Remove width/height for FLUX models (unless it's Fill which needs dimensions)
        if (!model.includes('fill')) {
          delete input.width;
          delete input.height;
          this.debugLog('[Replicate createImage] Removed width/height (using aspect_ratio)');
        }
      }

      // Add optional parameters
      if (cfg !== undefined) {
        input.guidance_scale = cfg;
        this.debugLog('[Replicate createImage] Set guidance_scale:', cfg);
      }
      if (steps !== undefined) {
        // Redux uses num_inference_steps, control models use steps
        if (model.includes('redux')) {
          input.num_inference_steps = steps;
          this.debugLog('[Replicate createImage] Set num_inference_steps:', steps);
        } else if (model.includes('canny') || model.includes('depth') || model.includes('fill')) {
          input.steps = steps;
          this.debugLog('[Replicate createImage] Set steps:', steps);
        } else {
          input.num_inference_steps = steps;
          this.debugLog('[Replicate createImage] Set num_inference_steps:', steps);
        }
      }
      if (seed !== undefined && seed !== null) {
        input.seed = seed;
        this.debugLog('[Replicate createImage] Set seed:', seed);
      }

      // Run prediction - with useFileOutput: false, returns URL strings
      // Log input object without Buffer data (which would be huge)
      const inputForLogging = { ...input };
      for (const key in inputForLogging) {
        if (Buffer.isBuffer(inputForLogging[key])) {
          inputForLogging[key] = `<Buffer ${inputForLogging[key].length} bytes>`;
        }
      }
      this.debugLog(
        '[Replicate createImage] Final input object:',
        JSON.stringify(inputForLogging, null, 2),
      );
      this.debugLog('[Replicate createImage] Calling client.run...');

      const output = await this.client.run(model as any, { input });

      this.debugLog('[Replicate createImage] Raw output:', output);
      this.debugLog(
        '[Replicate createImage] Output type:',
        typeof output,
        'Is array:',
        Array.isArray(output),
      );

      // Extract URL from output
      let outputImageUrl: string;

      if (Array.isArray(output)) {
        if (output.length === 0) {
          throw new Error('Replicate returned empty array');
        }
        // First item should be the URL string
        outputImageUrl = output[0];
        this.debugLog('[Replicate] Extracted URL from array:', outputImageUrl);
      } else if (typeof output === 'string') {
        outputImageUrl = output;
        this.debugLog('[Replicate] Output is direct string URL:', outputImageUrl);
      } else {
        throw new Error(`Unexpected output format from Replicate: ${typeof output}`);
      }

      if (typeof outputImageUrl !== 'string') {
        throw new Error(`Expected URL string, got ${typeof outputImageUrl}: ${outputImageUrl}`);
      }

      this.debugLog('[Replicate] Final imageUrl:', outputImageUrl);

      return {
        height: height,
        imageUrl: outputImageUrl,
        width: width,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Fetch image generation models from Replicate using search API
   * Uses targeted searches for relevant model categories instead of listing all public models
   */
  async models() {
    try {
      const modelMap = new Map<string, { created?: number; displayName?: string; id: string }>();

      // Search queries for different image model categories
      const searchQueries = [
        'flux image generation',
        'stable diffusion',
        'sdxl',
        'ideogram',
        'image to image',
        'text to image',
      ];

      // Search for each category and collect unique models
      for (const query of searchQueries) {
        try {
          // Use paginate for search results (limited results per query)
          for await (const models of this.client.paginate(() => this.client.models.search(query))) {
            for (const model of models) {
              const modelId = `${model.owner}/${model.name}`;
              // Deduplicate by model ID
              if (!modelMap.has(modelId)) {
                modelMap.set(modelId, {
                  created: model.latest_version
                    ? new Date(model.latest_version.created_at).getTime()
                    : undefined,
                  displayName: model.name,
                  id: modelId,
                });
              }
            }
            // Limit to first page of results per query to avoid too many results
            break;
          }
        } catch {
          // Continue with other searches if one fails
          this.debugLog(`[Replicate models] Search failed for query: ${query}`);
        }
      }

      const modelList = [...modelMap.values()];
      this.debugLog(`[Replicate models] Found ${modelList.length} unique models`);

      return processModelList(modelList, MODEL_LIST_CONFIGS.replicate, 'replicate');
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Error handling
   */
  private handleError(error: any): ChatCompletionErrorPayload {
    let desensitizedEndpoint = this.baseURL;

    if (this.baseURL !== DEFAULT_BASE_URL) {
      desensitizedEndpoint = desensitizeUrl(this.baseURL);
    }

    // Handle authentication errors
    if (error?.message?.includes('authentication') || error?.message?.includes('API token')) {
      throw AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: error as any,
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
        provider: this.id,
      });
    }

    // Handle model not found
    if (error?.message?.includes('not found')) {
      throw AgentRuntimeError.chat({
        endpoint: desensitizedEndpoint,
        error: error as any,
        errorType: AgentRuntimeErrorType.ModelNotFound,
        provider: this.id,
      });
    }

    // Generic error
    throw AgentRuntimeError.chat({
      endpoint: desensitizedEndpoint,
      error: error,
      errorType: AgentRuntimeErrorType.ProviderBizError,
      provider: this.id,
    });
  }

  /**
   * Gate verbose logging to avoid noisy output in production
   */
  private debugLog(...args: any[]) {
    const isReplicateDebug =
      process.env.DEBUG_REPLICATE === '1' ||
      process.env.DEBUG_REPLICATE_CHAT_COMPLETION === '1' ||
      process.env.NODE_ENV !== 'production';

    if (!isReplicateDebug) return;

    console.log(...args);
  }
}

export default LobeReplicateAI;
