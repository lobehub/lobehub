import type { TaskStatus } from './task';
import type { ChatTopicMetadata, ChatTopicStatus } from './topic/topic';

/**
 * Sidebar item type - can be an agent or a chat group
 */
export type SidebarItemType = 'agent' | 'group';

/**
 * Sidebar visibility scope. Mirrors the `visibility` column on agents /
 * chat_groups / session_groups. `private` items are only listed for the
 * creator within the workspace; `public` items are visible to every member.
 */
export type SidebarVisibility = 'private' | 'public';

/**
 * Avatar item for group members
 */
export interface GroupMemberAvatar {
  avatar: string;
  background?: string;
}

/**
 * Label applied to a sidebar agent. Mirrors the `agent_labels` registry
 * (workspace-shared, or personal when outside a workspace).
 */
export interface SidebarAgentLabel {
  color?: string | null;
  id: string;
  name: string;
}

/**
 * Full agent-label registry entry, as returned by the label management API.
 * Extends the lightweight {@link SidebarAgentLabel} with management fields.
 */
export interface AgentLabelListItem extends SidebarAgentLabel {
  archived: boolean;
  createdAt: Date;
  description?: string | null;
  /** Number of agents currently carrying this label. */
  usageCount: number;
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
  /**
   * Group's own avatar (emoji or uploaded image URL)
   * Only present for chat groups (type === 'group')
   */
  groupAvatar?: string | null;
  /**
   * Heterogeneous agent runtime type (e.g. `claude-code`) when the agent is
   * driven by an external CLI. `null` / absent means it's a regular LobeHub
   * agent. Present so sidebar / list items can render an "External" tag
   * without per-item agent config lookups.
   */
  heterogeneousType?: string | null;
  id: string;
  /**
   * Labels applied to the agent (absent for chat groups and unlabeled
   * agents). Used by the agents list to render label tags and group by label.
   */
  labels?: SidebarAgentLabel[];
  /**
   * The agent's personal name. Absent for chat groups and for agents created
   * before names existed — resolve the label with `agentDisplayName(item)`.
   */
  name?: string | null;
  pinned: boolean;
  sessionId?: string | null;
  /**
   * Agent slug. Builtin agents (LobeAI / agent-builder / …) are identified by
   * slug, letting the sidebar hide creator-only actions on official agents.
   * Absent for chat groups.
   */
  slug?: string | null;
  title: string | null;
  type: SidebarItemType;
  /**
   * Number of topics with an unread completed generation under this agent/group.
   * Derived server-side from `topics.status === 'unread'` so the sidebar badge
   * stays accurate across agents the client hasn't loaded topics for. Absent /
   * 0 means no unread.
   */
  unreadCount?: number;
  updatedAt: Date;
  /**
   * Creator of the item. Lets the client gate creator-only actions (e.g.
   * pulling a published agent back to private or deleting an agent group).
   */
  userId?: string | null;
  /**
   * `private` items are only visible to their creator within a workspace.
   * Absent / `public` for items that are visible to every workspace member or
   * for personal-mode rows that pre-date the column.
   */
  visibility?: SidebarVisibility;
}

/**
 * Sidebar group - a user-defined folder containing agents
 */
export interface SidebarGroup {
  id: string;
  items: SidebarAgentItem[];
  name: string;
  sort: number | null;
  /**
   * Visibility of the session group itself (same semantics as
   * {@link SidebarAgentItem.visibility}).
   */
  visibility?: SidebarVisibility;
}

/**
 * Response structure for sidebar agent list
 */
export interface SidebarAgentListResponse {
  groups: SidebarGroup[];
  pinned: SidebarAgentItem[];
  /**
   * Workspace-only: folders owned by the current user with
   * `visibility = 'private'`. Empty array in personal mode.
   */
  privateGroups: SidebarGroup[];
  /**
   * Workspace-only: pinned agents/chat groups owned by the current user with
   * `visibility = 'private'`. Kept out of {@link pinned} so the sidebar can
   * render them inside the Private section. Empty array in personal mode.
   */
  privatePinned: SidebarAgentItem[];
  /**
   * Workspace-only: ungrouped private agents/chat groups owned by the current
   * user. Empty array in personal mode.
   */
  privateUngrouped: SidebarAgentItem[];
  ungrouped: SidebarAgentItem[];
}

export interface HomeRecentItem {
  agentId?: string | null;
  /** User note on the topic; preferred over the last reply as the row snippet. */
  description?: string | null;
  icon: string;
  id: string;
  lastAssistantMessage?: string | null;
  metadata?: ChatTopicMetadata;
  routePath: string;
  status: TaskStatus | null;
  title: string;
  type: 'document' | 'task' | 'topic';
  updatedAt: Date | number | string;
  /** The member who owns this item — for author attribution in workspace team views. */
  userId?: string;
}

/** Minimal complete Topic view required by Home Dashboard and Home Inbox. */
export interface HomeTopicView {
  agentId?: string | null;
  createdAt?: Date | number | string;
  description?: string | null;
  id: string;
  lastAssistantMessage?: string | null;
  routePath?: string;
  runStartedAt?: Date | null;
  status?: ChatTopicStatus | null;
  title: string;
  trigger?: string | null;
  updatedAt: Date | number | string;
  userId?: string;
}

export interface HomeDailyBriefPair {
  hint: string;
  welcome: string;
}

export interface HomeDailyBriefResponse {
  pairs: HomeDailyBriefPair[];
}
