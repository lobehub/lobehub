import type { SessionGroupId } from './sessionGroup';

export * from './agentSession';
export * from './sessionGroup';

export interface UpdateSessionParams {
  group?: SessionGroupId;
  meta?: any;
  pinned?: boolean;
  updatedAt: Date;
}
