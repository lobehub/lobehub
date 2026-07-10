/**
 * Image Service
 *
 * Business logic for image processing including URL fetching
 * and workflow execution
 */
import { type CreateImagePayload, type CreateImageResponse } from '@lobechat/model-runtime';
import { type PromptBuilder } from '@saintno/comfyui-sdk';
import debug from 'debug';

import { type ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ErrorHandlerService } from '@/server/services/comfyui/core/errorHandlerService';
import { type ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import { type WorkflowBuilderService } from '@/server/services/comfyui/core/workflowBuilderService';
import { ServicesError } from '@/server/services/comfyui/errors';
import { imageResizer } from '@/server/services/comfyui/utils/imageResizer';
import { WorkflowDetector } from '@/server/services/comfyui/utils/workflowDetector';
import { nanoid } from '@/utils/uuid';

const log = debug('lobe-image:comfyui:image-service');

/**
 * Image Service
 * Handles all image generation business logic
 */
export class ImageService {
  private errorHandler: ErrorHandlerService;

  constructor(
    private clientService: ComfyUIClientService,
    private modelResolverService: ModelResolverService,
    private workflowBuilderService: WorkflowBuilderService,
  ) {
    this.errorHandler = new ErrorHandlerService();
  }

  /**
   * Create image with complete business logic
   * Optimized with parallel execution for independent operations
   */
  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    const { model } = payload;
    // Clone params to avoid modifying the original object
    const params = { ...payload.params };

    try {
      // First validate connection - this will throw auth errors if credentials are wrong
      await this.clientService.validateConnection();

      // Then validate model - only after we know connection is good
      // ModelResolverService will throw ModelResolverError if model not found
      const validation = await this.modelResolverService.validateModel(model);
      const modelFileName = validation.actualFileName!;

      // Get architecture from workflow detection for image resizing
      const detectionResult = WorkflowDetector.detectModelType(modelFileName);

      // Process image with architecture info for proper resizing
      // Note: This is fast if no imageUrl exists, so keeping it sequential is fine
      await this.processImageFetch(params, detectionResult.architecture);

      // Build workflow with processed params (imageUrl already replaced with ComfyUI filename)
      const workflow = await this.buildWorkflow(model, modelFileName, params);

      // Execute workflow
      const result = await this.clientService.executeWorkflow(workflow, (info: any) =>
        log('Progress:', info),
      );

      // Process results
      const images = result.images?.images ?? [];
      if (images.length === 0) {
        throw new ServicesError(
          'Empty result from ComfyUI workflow',
          ServicesError.Reasons.EMPTY_RESULT,
          { model, params },
        );
      }

      const imageInfo = images[0] as any;

      return {
        imageUrl: this.clientService.getPathImage(imageInfo),
      };
    } catch (error) {
      // All error handling delegated to ErrorHandlerService
      this.errorHandler.handleError(error);
    }
  }

  /**
   * Process image URLs for img2img workflows
   * Fetch image from URL, resize if needed, and upload to ComfyUI
   * Also saves original dimensions to params for frontend rendering
   */
  private async processImageFetch(
    params: Record<string, any>,
    architecture?: string,
  ): Promise<void> {
    const imageUrl = params.imageUrl || params.imageUrls?.[0];

    if (!imageUrl) {
      return;
    }

    log('Processing image URL:', imageUrl);

    try {
      // Check if it's already a ComfyUI filename (not a URL)
      // ComfyUI filenames don't contain protocol prefixes
      if (!imageUrl.includes('://')) {
        // Already processed or is a ComfyUI filename
        log('Image already processed or is ComfyUI filename:', imageUrl);
        return;
      }

      // Fetch image from URL (both S3 and Desktop static server use HTTP)
      log('Fetching image from URL:', imageUrl);
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new ServicesError(
          `Failed to fetch image: ${response.status} ${response.statusText}`,
          ServicesError.Reasons.IMAGE_FETCH_FAILED,
          { status: response.status, statusText: response.statusText, url: imageUrl },
        );
      }

      // Get image data as buffer
      const arrayBuffer = await response.arrayBuffer();
      let buffer = Buffer.from(arrayBuffer);
      log('Image fetched successfully, size:', buffer.length);

      // Validate image data
      if (!buffer || buffer.length === 0) {
        throw new ServicesError('Invalid image data', ServicesError.Reasons.IMAGE_FETCH_FAILED, {
          url: imageUrl,
        });
      }

      // Get image metadata using sharp (only on server-side)
      let originalWidth: number | undefined;
      let originalHeight: number | undefined;

      // Only use sharp on server-side (Node.js environment)
      if (typeof window === 'undefined') {
        const sharpModule = await import('sharp');
        const sharp = sharpModule.default;
        const sharpInstance = sharp(buffer);
        const metadata = await sharpInstance.metadata();
        originalWidth = metadata.width;
        originalHeight = metadata.height;
      } else {
        // Sharp was incorrectly bundled to client-side - this is a build configuration error
        throw new Error(
          'FATAL: Sharp module was bundled to browser environment. This is a build configuration error. ' +
            'Sharp is a native Node.js module and cannot run in the browser. ' +
            'Please check your Next.js or webpack configuration.',
        );
      }

      if (!originalWidth || !originalHeight) {
        throw new ServicesError(
          'Unable to read image dimensions',
          ServicesError.Reasons.IMAGE_FETCH_FAILED,
          { url: imageUrl },
        );
      }

      // Save original dimensions to params for frontend progress rendering
      // This ensures the progress block has the correct aspect ratio
      if (!params.width) {
        params.width = originalWidth;
      }
      if (!params.height) {
        params.height = originalHeight;
      }

      log('Original image dimensions:', { height: originalHeight, width: originalWidth });

      // Check if image needs resizing based on architecture
      // Architecture is guaranteed to exist from WorkflowDetector
      if (architecture) {
        const resizeResult = imageResizer.calculateTargetDimensions(
          originalWidth,
          originalHeight,
          architecture,
        );

        if (resizeResult.needsResize) {
          log('Image needs resizing for architecture:', {
            architecture,
            original: { height: originalHeight, width: originalWidth },
            target: { height: resizeResult.height, width: resizeResult.width },
          });

          // Resize image using sharp (only on server-side)
          if (typeof window === 'undefined') {
            const sharpModule = await import('sharp');
            const sharp = sharpModule.default;
            buffer = Buffer.from(
              await sharp(buffer)
                .resize(resizeResult.width, resizeResult.height, {
                  fit: 'inside', // Maintain aspect ratio, fit within bounds
                  withoutEnlargement: false, // Allow enlargement if needed
                })
                .toBuffer(),
            );
            log('Image resized successfully, new size:', buffer.length);
          } else {
            log('Warning: Cannot resize image in browser environment');
          }
        } else {
          log('Image dimensions are within model limits, no resize needed');
        }
      }

      // Upload to ComfyUI - use timestamp + 4-char random ID to prevent conflicts
      const fileName = `LobeChat_img2img_${Date.now()}_${nanoid(4)}.png`;
      const uploadedFileName = await this.clientService.uploadImage(buffer, fileName);

      log('Uploaded to ComfyUI as:', uploadedFileName);

      // Replace the URL with ComfyUI filename
      params.imageUrl = uploadedFileName;
      if (params.imageUrls) {
        // Clone the array to avoid modifying the original
        params.imageUrls = [...params.imageUrls];
        params.imageUrls[0] = uploadedFileName;
      }

      log('Successfully replaced imageUrl with ComfyUI filename');
    } catch (error) {
      log('Failed to process image URL:', error);
      throw error;
    }
  }

  /**
   * Build workflow using detection and builder service
   */
  private async buildWorkflow(
    model: string,
    modelFileName: string,
    params: Record<string, any>,
  ): Promise<PromptBuilder<any, any, any>> {
    log('Building workflow for model:', model);

    // Use the resolved filename for detection
    const detectionResult = WorkflowDetector.detectModelType(modelFileName);
    log('Model detection result:', detectionResult);

    if (!detectionResult.isSupported) {
      throw new ServicesError(
        `Unsupported model type: ${model}`,
        ServicesError.Reasons.MODEL_NOT_FOUND,
        { model, modelFileName },
      );
    }

    // Build workflow using service
    const workflow = await this.workflowBuilderService.buildWorkflow(
      model,
      detectionResult,
      modelFileName,
      params,
    );

    log('Workflow built successfully for:', model);
    return workflow;
  }
}
