import type { ProjectionAvatar, ProjectionVisibility } from './shared';

export interface ChatGroupProjectionFragments {
  access: {
    userId?: string | null;
    visibility?: ProjectionVisibility;
  };
  identity: {
    avatar?: ProjectionAvatar;
    backgroundColor?: string | null;
    description?: string | null;
    groupAvatar?: string | null;
    title: string | null;
  };
}
