// Inspector components (customized tool call headers)
export { LocalSystemInspectors } from './Inspector';

// Render components (read-only snapshots)
export { LocalSystemRenders } from './Render';

// Intervention components (approval dialogs)
export { LocalSystemInterventions } from './Intervention';

// Streaming components
export { LocalSystemStreamings } from './Streaming';

// Placeholder components
export { ListFiles as LocalSystemListFilesPlaceholder } from './Placeholder/ListFiles';
export { default as LocalSystemSearchFilesPlaceholder } from './Placeholder/SearchFiles';

// Re-export types and manifest for convenience
export { LocalSystemManifest } from '../manifest';
export { LocalSystemIdentifier } from '../types';
export * from '../types';
