// Inspector components (customized tool call headers)
export { NotebookInspectors } from './Inspector';

// Intervention components (approval dialogs)
export { NotebookInterventions } from './Intervention';

// Placeholder components (loading states)
export { CreateDocumentPlaceholder, NotebookPlaceholders } from './Placeholder';

// Render components (read-only snapshots)
export { CreateDocument, NotebookRenders } from './Render';

// Streaming components
export { NotebookStreamings } from './Streaming';

// Re-export types and manifest for convenience
export { NotebookManifest } from '../manifest';
export * from '../types';
