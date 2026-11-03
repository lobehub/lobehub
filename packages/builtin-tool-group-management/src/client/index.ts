// Inspector components (title/header area)
export { GroupManagementInspectors } from './Inspector';

// Streaming components (real-time feedback)
export { GroupManagementStreamings } from './Streaming';

// Render components (read-only snapshots)
export { BroadcastRender, ExecuteTaskRender, GroupManagementRenders, SpeakRender } from './Render';

// Intervention components (interactive editing)
export { ExecuteTaskIntervention, GroupManagementInterventions } from './Intervention';

// Re-export types and manifest for convenience
export { GroupManagementManifest } from '../manifest';
export * from '../types';
