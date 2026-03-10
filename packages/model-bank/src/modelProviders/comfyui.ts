import type { ModelProviderCard } from '@/types/llm';

/**
 * ComfyUI Provider Configuration
 *
 * Supports local and remote ComfyUI server connections
 * Provides image generation capabilities for FLUX series models
 *
 * @see https://www.comfy.org/
 */
const ComfyUI: ModelProviderCard = {
  chatModels: [],
  description:
    'A powerful open-source workflow engine for image, video, and audio generation, supporting models like SD, FLUX, Qwen, Hunyuan, and WAN with node-based editing and private deployment.',
  id: 'comfyui',
  name: 'ComfyUI',
  settings: {
    // Disable direct browser requests, proxy through server
    disableBrowserRequest: true,

    // SDK type identifier
    sdkType: 'comfyui',

    // Hide add new model button (models managed via configuration)
    showAddNewModel: false,

    // Show API key configuration (for authentication setup)
    showApiKey: true,

    // Hide connectivity check (image generation doesn't support chat interface checks)
    showChecker: false,

    // Hide model fetcher (use predefined models)
    showModelFetcher: false,
  },
  url: 'https://www.comfy.org/',
};

export default ComfyUI;
