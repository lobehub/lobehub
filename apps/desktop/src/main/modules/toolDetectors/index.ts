/**
 * Tool Detectors Module
 *
 * This module provides built-in tool detectors for common system tools.
 * Modules can register additional custom detectors via ToolDetectorManager.
 */

export { astSearchDetectors, contentSearchDetectors } from './contentSearchDetectors';
export { fileSearchDetectors } from './fileSearchDetectors';

// Re-export types for convenience
export type {
  IToolDetector,
  ToolCategory,
  ToolStatus,
} from '@/core/infrastructure/ToolDetectorManager';
export { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';
