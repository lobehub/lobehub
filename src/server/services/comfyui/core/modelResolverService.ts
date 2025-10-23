/**
 * Model Resolver Service
 *
 * Unified service for model, VAE, and component resolution
 * Handles all model-related operations through the client service
 */
import debug from 'debug';

import {
  COMPONENT_NODE_MAPPINGS,
  CUSTOM_SD_CONFIG,
  SUPPORTED_MODEL_FORMATS,
} from '@/server/services/comfyui/config/constants';
import {
  MODEL_ID_VARIANT_MAP,
  MODEL_REGISTRY,
} from '@/server/services/comfyui/config/modelRegistry';
import { SYSTEM_COMPONENTS } from '@/server/services/comfyui/config/systemComponents';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ModelResolverError } from '@/server/services/comfyui/errors/modelResolverError';
import { TTLCacheManager } from '@/server/services/comfyui/utils/cacheManager';
import { getModelsByVariant } from '@/server/services/comfyui/utils/staticModelLookup';

const log = debug('lobe-image:comfyui:model-resolver');

/**
 * Check if a filename has a supported model format extension
 * @param filename - The filename to check
 * @returns True if the filename has a supported model format extension
 */
const isModelFile = (filename: string): boolean => {
  return SUPPORTED_MODEL_FORMATS.some((ext) => filename.endsWith(ext));
};

/**
 * Model validation result
 */
export interface ModelValidationResult {
  actualFileName?: string;
  exists: boolean;
}

/**
 * Internal model resolution details
 */
interface ModelResolutionDetails {
  cleanId: string;
  expectedFiles: string[];
  fileName?: string;
  variant?: string;
}

/**
 * Model Resolver Service
 * Provides model resolution, validation, and component selection
 *
 * Caching strategy:
 * - Model name resolution: Cached locally (business logic)
 * - Component lists (VAE, CLIP, etc.): Cached in ComfyUIClientService
 *
 * @params clientService - The ComfyUI client service instance
 * @returns The resolved model filename or undefined if not found
 * @note This service does not handle workflow building or execution
 */
export class ModelResolverService {
  private clientService: ComfyUIClientService;
  private cacheManager: TTLCacheManager;

  constructor(clientService: ComfyUIClientService) {
    this.clientService = clientService;
    this.cacheManager = new TTLCacheManager(60_000); // 1 minute TTL
  }

  /**
   * Internal method to resolve model details with all information
   * This eliminates DRY violations between resolveModelFileName and validateModel
   */
  private async _resolveModelDetails(modelId: string): Promise<ModelResolutionDetails> {
    log('Resolving model details:', modelId);

    // Clean model ID (remove prefix)
    const cleanId = modelId.replace(/^comfyui\//, '');

    // Get mapped variant and expected files
    const mappedVariant = MODEL_ID_VARIANT_MAP[cleanId];
    const expectedFiles = mappedVariant ? getModelsByVariant(mappedVariant) : [];

    // Special handling for custom SD models - force fixed filename
    if (cleanId === 'stable-diffusion-custom' || cleanId === 'stable-diffusion-custom-refiner') {
      const fixedFileName = CUSTOM_SD_CONFIG.MODEL_FILENAME;

      // Verify the custom model file exists on server
      const serverModels = await this.getAvailableModelFiles();
      const fileName = serverModels.includes(fixedFileName) ? fixedFileName : undefined;

      if (fileName) {
        log('Resolved custom SD model to fixed filename:', fileName);
      }

      return {
        cleanId,
        expectedFiles,
        fileName,
        variant: mappedVariant,
      };
    }

    // 1. Try model ID mapping first
    log('Checking MODEL_ID_VARIANT_MAP for:', cleanId);
    log('Mapped variant result:', mappedVariant);

    if (mappedVariant) {
      log('Found model ID mapping:', cleanId, '->', mappedVariant);
      log('Prioritized models for variant', mappedVariant, ':', expectedFiles);

      const serverModels = await this.getAvailableModelFiles();

      // Find first available model from prioritized list
      for (const filename of expectedFiles) {
        if (serverModels.includes(filename)) {
          log('Found available model by variant:', filename);
          return {
            cleanId,
            expectedFiles,
            fileName: filename,
            variant: mappedVariant,
          };
        }
      }

      log('No prioritized models available on server for variant:', mappedVariant);
    } else {
      log('No mapping found for cleanId:', cleanId);
    }

    // 2. Direct registry lookup (filename is the registry key)
    if (MODEL_REGISTRY[cleanId]) {
      log('Found in registry:', cleanId);
      return {
        cleanId,
        expectedFiles,
        fileName: cleanId,
        variant: mappedVariant,
      };
    }

    // 3. If it's already a model file format, check if it exists on server
    if (isModelFile(cleanId)) {
      const serverModels = await this.getAvailableModelFiles();
      if (serverModels.includes(cleanId)) {
        log('Found on server:', cleanId);
        return {
          cleanId,
          expectedFiles,
          fileName: cleanId,
          variant: mappedVariant,
        };
      }
    }

    // 4. Not found
    return {
      cleanId,
      expectedFiles,
      fileName: undefined,
      variant: mappedVariant,
    };
  }

  /**
   * Resolve a model ID to its actual filename
   * Fixed: removed over-defensive programming and guessing strategies
   */
  async resolveModelFileName(modelId: string): Promise<string | undefined> {
    return this.cacheManager.get(`model:${modelId}`, async () => {
      const details = await this._resolveModelDetails(modelId);
      return details.fileName;
    });
  }

  /**
   * Get available model files from server
   */
  async getAvailableModelFiles(): Promise<string[]> {
    const checkpoints = await this.clientService.getCheckpoints();
    return checkpoints || [];
  }

  /**
   * Get available VAE files from server
   * Note: Results are cached in ComfyUIClientService.getNodeDefs()
   */
  async getAvailableVAEFiles(): Promise<string[]> {
    // Use SDK's getNodeDefs method (already includes caching)
    const nodeDefs = await this.clientService.getNodeDefs('VAELoader');

    if (!nodeDefs?.VAELoader?.input?.required?.vae_name?.[0]) {
      return [];
    }

    const vaeList = nodeDefs.VAELoader.input.required.vae_name[0];
    if (!Array.isArray(vaeList)) {
      return [];
    }

    return vaeList;
  }

  /**
   * Get available component files from ComfyUI node
   * Generic method that queries ComfyUI for any node type's available files
   * Note: Results are cached in ComfyUIClientService.getNodeDefs()
   * @param loaderNode - The ComfyUI node name (e.g., 'CLIPLoader', 'VAELoader')
   * @param inputKey - The input field name to query (e.g., 'clip_name', 'vae_name')
   */
  async getAvailableComponentFiles(loaderNode: string, inputKey: string): Promise<string[]> {
    const nodeDefs = await this.clientService.getNodeDefs(loaderNode);
    const loader = nodeDefs?.[loaderNode];

    if (!loader?.input?.required?.[inputKey]?.[0]) {
      // Node doesn't exist or no files available - normal case
      return [];
    }

    const componentList = loader.input.required[inputKey][0];
    if (!Array.isArray(componentList)) {
      return [];
    }

    return componentList;
  }

  /**
   * Get optimal component for a specific type and model family
   * New method: provides single component query functionality
   * @param type - Component type (clip, t5, vae, unet)
   * @param modelFamily - Model family (FLUX, SD3, etc.)
   * @returns The best matching component name
   */
  async getOptimalComponent(type: string, modelFamily: string): Promise<string | undefined> {
    // Get prioritized components from configuration
    const configComponents = Object.entries(SYSTEM_COMPONENTS)
      .filter(([, config]) => config.type === type && config.modelFamily === modelFamily)
      .sort(([, a], [, b]) => a.priority - b.priority);

    // Get node mapping for this component type
    const nodeMapping = COMPONENT_NODE_MAPPINGS[type];
    if (!nodeMapping) {
      return undefined;
    }

    // Get available files from server
    const serverFiles = await this.getAvailableComponentFiles(nodeMapping.node, nodeMapping.field);

    // Return first matching component from config priority
    for (const [name] of configComponents) {
      if (serverFiles.includes(name)) {
        return name;
      }
    }

    // No matching component found
    return undefined;
  }

  /**
   * Validate if a model exists
   * @throws ModelResolverError if model not found with details about expected files
   */
  async validateModel(modelId: string): Promise<ModelValidationResult> {
    // Use the internal method to get all resolution details
    const details = await this._resolveModelDetails(modelId);

    if (!details.fileName) {
      // Create simplified error message with only top priority models
      // expectedFiles are already sorted by priority from getModelsByVariant
      const topPriorityFiles = details.expectedFiles.slice(0, 1); // Show top priority options

      let errorMessage = `Model not found: ${topPriorityFiles.join(', ')}, please install one first.`;

      throw new ModelResolverError(ModelResolverError.Reasons.MODEL_NOT_FOUND, errorMessage, {
        expectedFiles: details.expectedFiles,
        modelId,
        variant: details.variant,
      });
    }

    return { actualFileName: details.fileName, exists: true };
  }
}
