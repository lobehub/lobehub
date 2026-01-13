// Inspector components (customized tool call headers)
export { WebBrowsingInspectors } from './Inspector';

// Render components (read-only snapshots)
export { WebBrowsingRenders } from './Render';

// Placeholder components (loading states)
export { WebBrowsingPlaceholders } from './Placeholder';

// Portal component (detailed view in portal)
export { default as WebBrowsingPortal } from './Portal';

// Reusable components
export { CategoryAvatar, EngineAvatar, EngineAvatarGroup, SearchBar } from './components';

// Re-export types and manifest for convenience
export { WebBrowsingManifest } from '../manifest';
export * from '../types';
