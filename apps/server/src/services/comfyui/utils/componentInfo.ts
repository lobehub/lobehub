/**
 * Shared utility for component information
 * Single source of truth for component type resolution and path generation
 */
import { COMPONENT_NODE_MAPPINGS } from '@/server/services/comfyui/config/constants';
import { SYSTEM_COMPONENTS } from '@/server/services/comfyui/config/systemComponents';

export interface ComponentInfo {
  displayName: string;
  folderPath: string;
  nodeType: string;
  type: string;
}

/**
 * Get human-readable component type name
 */
export function getComponentDisplayName(type: string): string {
  switch (type) {
    case 't5': {
      return 'T5 text encoder';
    }
    case 'clip': {
      return 'CLIP text encoder';
    }
    case 'vae': {
      return 'VAE model';
    }
    default: {
      return `${type.toUpperCase()} component`;
    }
  }
}

/**
 * Get component folder path for ComfyUI
 * Based on ComfyUI's folder_paths.py configuration
 * CLIP and T5 both go in either text_encoders or clip folder
 */
export function getComponentFolderPath(type: string): string {
  // ComfyUI accepts both models/text_encoders and models/clip for text encoders
  // We use models/clip as it's more commonly recognized
  if (type === 'clip' || type === 't5') {
    return 'models/clip';
  }
  // VAE goes to models/vae
  if (type === 'vae') {
    return 'models/vae';
  }
  // Default pattern for other types
  return `models/${type}`;
}

/**
 * Get component information from filename
 * This is the SINGLE source for component resolution logic
 * Used by both ModelResolverService and error parser
 */
export function getComponentInfo(fileName: string): ComponentInfo | undefined {
  const config = SYSTEM_COMPONENTS[fileName];
  if (!config) return undefined;

  const { type } = config;
  const nodeMapping = COMPONENT_NODE_MAPPINGS[type];
  if (!nodeMapping) return undefined;

  // Centralized logic for display name generation
  const displayName = getComponentDisplayName(type);

  // Centralized logic for folder path generation
  const folderPath = getComponentFolderPath(type);

  return {
    displayName,
    folderPath,
    nodeType: nodeMapping.node,
    type,
  };
}

/**
 * Check if a filename is a known system component
 */
export function isSystemComponent(fileName: string): boolean {
  return fileName in SYSTEM_COMPONENTS;
}
