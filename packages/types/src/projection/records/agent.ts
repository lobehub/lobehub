import type { ProjectionAvatar, ProjectionVisibility } from './shared';

export interface AgentProjectionFragments {
  access: {
    userId?: string | null;
    visibility?: ProjectionVisibility;
  };
  identity: {
    avatar?: ProjectionAvatar;
    backgroundColor?: string | null;
    name?: string | null;
    title: string | null;
  };
  profile: {
    description?: string | null;
    slug?: string | null;
  };
  routing: {
    sessionId?: string | null;
  };
  runtime: {
    heterogeneousType?: string | null;
  };
}
