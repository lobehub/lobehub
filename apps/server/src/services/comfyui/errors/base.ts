/**
 * Base class for all ComfyUI internal errors
 *
 * All ComfyUI internal layers (config, workflow, utils, services) should use these
 * internal error classes instead of framework errors to maintain proper
 * architectural boundaries.
 */
export abstract class ComfyUIInternalError extends Error {
  public readonly reason: string;
  public readonly details?: Record<string, any>;

  constructor(message: string, reason: string, details?: Record<string, any>) {
    super(message);
    this.reason = reason;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ComfyUIInternalError);
    }
  }
}
