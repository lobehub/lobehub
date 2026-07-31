import type { EntityAvatar, EntityVisibility } from './shared';

export interface AgentEntityFragments {
  access: {
    userId?: string | null;
    visibility?: EntityVisibility;
  };
  identity: {
    avatar?: EntityAvatar;
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
