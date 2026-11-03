import { ComfyUIInternalError } from './base';
import { ModelResolverError } from './modelResolverError';

/**
 * Type guard to check if an error is a ComfyUI internal error
 *
 * @param error - The error to check
 * @returns True if the error is a ComfyUI internal error
 */
export function isComfyUIInternalError(error: unknown): error is ComfyUIInternalError {
  return error instanceof ComfyUIInternalError || error instanceof ModelResolverError;
}
