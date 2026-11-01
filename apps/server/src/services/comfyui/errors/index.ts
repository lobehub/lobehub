/**
 * ComfyUI Internal Error System
 *
 * All ComfyUI internal layers (config, workflow, utils, services) should use these
 * internal error classes instead of framework errors to maintain proper
 * architectural boundaries.
 *
 * File organization:
 * - base.ts: Base error class
 * - configError.ts: Configuration layer errors
 * - workflowError.ts: Workflow layer errors
 * - utilsError.ts: Utility layer errors
 * - servicesError.ts: Service layer errors
 * - modelResolverError.ts: Model resolver specific errors
 * - typeGuards.ts: Type guard utilities
 */

// Base class
export { ComfyUIInternalError } from './base';

// Error classes
export { ConfigError } from './configError';
export { ModelResolverError } from './modelResolverError';
export { ServicesError } from './servicesError';
export { UtilsError } from './utilsError';
export { WorkflowError } from './workflowError';

// Type guards
export { isComfyUIInternalError } from './typeGuards';
