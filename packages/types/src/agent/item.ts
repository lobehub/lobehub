import type { LLMParams } from 'model-bank';

import type { FileItem } from '../files';
import type { KnowledgeBaseItem } from '../knowledgeBase';
import type { FewShots } from '../llm';
import type { LobeAgentChatConfig } from './chatConfig';
import type { LobeAgentTTSConfig } from './tts';

export interface LobeAgentConfig {
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

// Agent database item type (independent from schema)
export interface AgentItem {
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
