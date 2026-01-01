import { LLMParams } from 'model-bank';

import { FileItem } from '../files';
import { KnowledgeBaseItem } from '../knowledgeBase';
import { FewShots } from '../llm';
import { LobeAgentChatConfig } from './chatConfig';
import { LobeAgentTTSConfig } from './tts';

export interface LobeAgentConfig {
  avatar?: string;

  chatConfig: LobeAgentChatConfig;

  /**
   * 编辑器内容（JSON 格式）
   * 用于保存富文本编辑器的完整状态，包括 mention 等特殊节点
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
   * 角色所使用的语言模型
   * @default gpt-4o-mini
   */
  model: string;

  /**
   * 开场白
   */
  openingMessage?: string;
  /**
   * 开场问题
   */
  openingQuestions?: string[];

  /**
   * 语言模型参数
   */
  params: LLMParams;
  /**
   * 启用的插件
   */
  plugins?: string[];

  /**
   *  模型供应商
   */
  provider?: string;

  /**
   * 系统角色
   */
  systemRole: string;

  /**
   * 语音服务
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
