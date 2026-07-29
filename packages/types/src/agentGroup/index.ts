import { z } from 'zod';

import type { AgentItem } from '../agent';

export interface LobeChatGroupMetaConfig {
  avatar?: string;
  backgroundColor?: string;
  description: string;
  marketIdentifier?: string;
  title: string;
}

export interface LobeChatGroupChatConfig {
  allowDM?: boolean;
  forkedFromIdentifier?: string;
  openingMessage?: string;
  openingQuestions?: string[];
  revealDM?: boolean;
  systemPrompt?: string;
}

// Database config type (flat structure)
export type LobeChatGroupConfig = LobeChatGroupChatConfig;

// Zod schema for ChatGroupConfig (database insert)
export const ChatGroupConfigSchema = z.object({
  allowDM: z.boolean().optional(),
  forkedFromIdentifier: z.string().optional(),
  openingMessage: z.string().optional(),
  openingQuestions: z.array(z.string()).optional(),
  revealDM: z.boolean().optional(),
  systemPrompt: z.string().optional(),
});

// Zod schema for inserting ChatGroup
export const InsertChatGroupSchema = z.object({
  avatar: z.string().nullish(),
  backgroundColor: z.string().nullish(),
  clientId: z.string().nullish(),
  config: ChatGroupConfigSchema.nullish(),
  content: z.string().nullish(),
  description: z.string().nullish(),
  editorData: z.record(z.string(), z.any()).nullish(),
  groupId: z.string().nullish(),
  id: z.string().optional(),
  marketIdentifier: z.string().nullish(),
  pinned: z.boolean().nullish(),
  title: z.string().nullish(),
  /**
   * `private` keeps the chat group visible only to its creator within the
   * workspace; `public` (default) makes it visible to every workspace member.
   * Ignored in personal mode.
   */
  visibility: z.enum(['private', 'public']).optional(),
});

export type InsertChatGroup = z.infer<typeof InsertChatGroupSchema>;

// Full group type with nested structure for UI components
export interface LobeChatGroupFullConfig {
  chat: LobeChatGroupChatConfig;
  meta: LobeChatGroupMetaConfig;
}

// Chat Group Agent types (independent from schema)
export interface ChatGroupAgent {
  agentId: string;
  chatGroupId: string;
  createdAt: Date;
  enabled?: boolean;
  order?: number;
  role?: string;
  updatedAt: Date;
  userId: string;
}

export interface NewChatGroupAgent {
  agentId: string;
  chatGroupId: string;
  enabled?: boolean;
  order?: number;
  role?: string;
  userId: string;
}

// New Chat Group type for creating groups (independent from schema)
export interface NewChatGroup {
  avatar?: string | null;
  backgroundColor?: string | null;
  clientId?: string | null;
  config?: LobeChatGroupConfig | null;
  description?: string | null;
  groupId?: string | null;
  id?: string;
  marketIdentifier?: string | null;
  pinned?: boolean | null;
  title?: string | null;
  userId: string;
}

// Chat Group Item type (independent from schema)
export interface ChatGroupItem {
  accessedAt?: Date;
  avatar?: string | null;
  backgroundColor?: string | null;
  clientId?: string | null;
  config?: LobeChatGroupConfig | null;
  content?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: Record<string, any> | null;
  groupId?: string | null;
  id: string;
  marketIdentifier?: string | null;
  pinned?: boolean | null;
  title?: string | null;
  updatedAt: Date;
  userId: string;
  /** Workspace visibility; absent only on legacy/personal group payloads. */
  visibility?: 'private' | 'public';
  /** Owning workspace; null for personal (non-workspace) groups. */
  workspaceId?: string | null;
}

// Agent item with group role info
export type AgentGroupMember = AgentItem & {
  /**
   * Whether this agent is the supervisor of the group
   */
  isSupervisor: boolean;
};

// Agent Group Detail - extends ChatGroupItem with agents
export interface AgentGroupDetail extends ChatGroupItem {
  agents: AgentGroupMember[];
  /**
   * The supervisor agent ID, if exists
   */
  supervisorAgentId?: string;
}

// Re-export agent execution types for backwards compatibility
export type {
  ExecAgentAppContext,
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentNewTopicOptions,
  ExecGroupAgentParams,
  ExecGroupAgentResponse,
  ExecGroupAgentResult,
  ExecGroupSubAgentTaskParams,
  ExecGroupSubAgentTaskResult,
  ExecSubAgentParams,
  ExecSubAgentResult,
  TaskCurrentActivity,
  TaskStatusResult,
} from '../agentExecution';
