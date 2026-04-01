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
  avatar: z.string().optional().nullable(),
  backgroundColor: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  config: ChatGroupConfigSchema.optional().nullable(),
  content: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  editorData: z.record(z.string(), z.any()).optional().nullable(),
  groupId: z.string().optional().nullable(),
  id: z.string().optional(),
  marketIdentifier: z.string().optional().nullable(),
  pinned: z.boolean().optional().nullable(),
  title: z.string().optional().nullable(),
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
  ExecSubAgentTaskParams,
  ExecSubAgentTaskResult,
  TaskCurrentActivity,
  TaskStatusResult,
} from '../agentExecution';
