// Inspector components (customized tool call headers)
export { KnowledgeBaseInspectors } from './Inspector';

// Render components (read-only snapshots)
export { KnowledgeBaseRenders } from './Render';

// Client-side executor (browser runtime adapter for the agent)
export { knowledgeBaseExecutor } from './executor';

// Re-export types and manifest for convenience
export { KnowledgeBaseManifest } from '../manifest';
export * from '../types';
