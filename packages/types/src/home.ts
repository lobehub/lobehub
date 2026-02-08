/**
 * Sidebar item type - can be an agent or a chat group
 */
export type SidebarItemType = 'agent' | 'group';

/**
 * Avatar item for group members
 */
export interface GroupMemberAvatar {
  avatar: string;
  background?: string;
}

/**
 * Sidebar agent item - represents an agent or chat group in the sidebar
 */
export interface SidebarAgentItem {
  /**
   * Avatar can be:
   * - string: single avatar for agents or custom group avatar
   * - GroupMemberAvatar[]: array of member avatars for groups (when no custom avatar)
   * - null: no avatar
   */
  avatar?: GroupMemberAvatar[] | string | null;
  /**
   * Background color for the avatar (used for custom group avatars)
   */
  backgroundColor?: string | null;
  description?: string | null;
  id: string;
  pinned: boolean;
  sessionId?: string | null;
  title: string | null;
  type: SidebarItemType;
  updatedAt: Date;
}

/**
 * Sidebar group - a user-defined folder containing agents
 */
export interface SidebarGroup {
  id: string;
  items: SidebarAgentItem[];
  name: string;
  sort: number | null;
}

/**
 * Response structure for sidebar agent list
 */
export interface SidebarAgentListResponse {
  groups: SidebarGroup[];
  pinned: SidebarAgentItem[];
  ungrouped: SidebarAgentItem[];
}
