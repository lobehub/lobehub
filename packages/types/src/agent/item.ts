import type { LLMParams } from 'model-bank';
import { z } from 'zod';

import type { FileItem } from '../files';
import type { KnowledgeBaseItem } from '../knowledgeBase';
import type { FewShots } from '../llm';
import type { LobeAgentAgencyConfig } from './agencyConfig';
import { AgentChatConfigSchema, type LobeAgentChatConfig } from './chatConfig';
import type { LobeAgentTTSConfig } from './tts';

export interface LobeAgentConfig {
  /**
   * Agency configuration: device binding, heterogeneous agent provider, etc.
   */
  agencyConfig?: LobeAgentAgencyConfig;

  avatar?: string;
  backgroundColor?: string;

  chatConfig: LobeAgentChatConfig;

  /**
   * Editor content (JSON format)
   * Used to save the complete state of the rich text editor, including special nodes like mention
   */
  editorData?: any;
  enableAgentMode?: boolean;
  fewShots?: FewShots;
  files?: FileItem[];
  id?: string;

  /**
   * knowledge bases
   */
  knowledgeBases?: KnowledgeBaseItem[];
  /**
   * Language model used by the agent
   * @default gpt-4o-mini
   */
  model: string;

  /**
   * Opening message
   */
  openingMessage?: string;
  /**
   * Opening questions
   */
  openingQuestions?: string[];

  /**
   * Language model parameters
   */
  params: LLMParams;
  /**
   * Enabled plugins
   */
  plugins?: string[];

  /**
   *  Model provider
   */
  provider?: string;

  /**
   * System role
   */
  systemRole: string;

  /**
   * Agent title/name
   */
  title?: string;

  /**
   * Text-to-speech service
   */
  tts: LobeAgentTTSConfig;

  /**
   * Flag for assistants generated automatically (e.g., from templates)
   */
  virtual?: boolean;
}

export type LobeAgentConfigKeys =
  | keyof LobeAgentConfig
  | ['params', keyof LobeAgentConfig['params']];

/**
 * Zod schema for creating a new agent.
 * Covers all user-configurable fields; system fields (id, userId, timestamps) are excluded.
 */
export const CreateAgentSchema = z.object({
  agencyConfig: z.custom<LobeAgentAgencyConfig>().optional(),
  avatar: z.string().nullable().optional(),
  backgroundColor: z.string().nullable().optional(),
  chatConfig: AgentChatConfigSchema.optional(),
  description: z.string().nullable().optional(),
  editorData: z.unknown().optional(),
  fewShots: z.unknown().optional(),
  marketIdentifier: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  openingMessage: z.string().nullable().optional(),
  openingQuestions: z.array(z.string()).optional(),
  params: z.record(z.unknown()).optional(),
  plugins: z.array(z.string()).optional(),
  provider: z.string().nullable().optional(),
  sessionGroupId: z.string().nullable().optional(),
  systemRole: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  title: z.string().nullable().optional(),
  tts: z.custom<LobeAgentTTSConfig>().optional(),
  virtual: z.boolean().nullable().optional(),
});

export type CreateAgentConfig = z.infer<typeof CreateAgentSchema>;

// Agent database item type (independent from schema)
export interface AgentItem {
  agencyConfig?: LobeAgentAgencyConfig | null;
  avatar?: string | null;
  backgroundColor?: string | null;
  chatConfig?: LobeAgentChatConfig | null;
  clientId?: string | null;
  createdAt: Date;
  description?: string | null;
  editorData?: any | null;
  fewShots?: any | null;
  id: string;
  /** Market agent identifier for published agents */
  marketIdentifier?: string | null;
  model?: string | null;
  openingMessage?: string | null;
  openingQuestions?: string[];
  params?: any;
  plugins?: string[];
  provider?: string | null;
  /** Session group ID for direct grouping */
  sessionGroupId?: string | null;
  slug?: string | null;
  systemRole?: string | null;
  tags?: string[];
  title?: string | null;
  tts?: LobeAgentTTSConfig | null;
  updatedAt: Date;
  userId: string;
  virtual?: boolean | null;
}
