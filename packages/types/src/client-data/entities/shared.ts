export interface EntityGroupMemberAvatar {
  avatar: string;
  background?: string;
}

export type EntityAvatar = EntityGroupMemberAvatar[] | string | null;
export type EntityVisibility = 'private' | 'public';
