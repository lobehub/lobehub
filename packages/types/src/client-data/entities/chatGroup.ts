import type { EntityAvatar, EntityVisibility } from './shared';

export interface ChatGroupEntityFragments {
  access: {
    userId?: string | null;
    visibility?: EntityVisibility;
  };
  identity: {
    avatar?: EntityAvatar;
    backgroundColor?: string | null;
    description?: string | null;
    groupAvatar?: string | null;
    title: string | null;
  };
}
