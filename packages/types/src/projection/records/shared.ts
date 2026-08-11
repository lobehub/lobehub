export interface ProjectionGroupMemberAvatar {
  avatar: string;
  background?: string;
}

export type ProjectionAvatar = ProjectionGroupMemberAvatar[] | string | null;
export type ProjectionVisibility = 'private' | 'public';
