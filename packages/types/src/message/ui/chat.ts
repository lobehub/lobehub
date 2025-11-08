import { MetaData } from '../../meta';
import { GroundingSearch } from '../../search';
import {
  ChatImageItem,
  ChatMessageError,
  MessageMetadata,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
} from '../common';
import { ChatPluginPayload, ChatToolPayload, ChatToolPayloadWithResult } from '../common/tools';
import { ChatMessageExtra } from './extra';
import { ChatFileChunk } from './rag';
import { ChatVideoItem } from './video';

export type UIMessageRoleType = 'user' | 'system' | 'assistant' | 'tool' | 'supervisor' | 'group';

export interface ChatFileItem {
  content?: string;
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface AssistantContentBlock {
  content: string;
  fileList?: ChatFileItem[];
  id: string;
  imageList?: ChatImageItem[];
  performance?: ModelPerformance;
  tools?: ChatToolPayloadWithResult[];
  usage?: ModelUsage;
}

export interface UIChatMessage {
  // Group chat fields (alphabetically before other fields)
  agentId?: string | 'supervisor';
  /**
   * children messages for grouped display
   * Used to group tool messages under their parent assistant message
   */
  children?: AssistantContentBlock[];
  chunksList?: ChatFileChunk[];
  content: string;
  createdAt: number;
  error?: ChatMessageError | null;
  // 扩展字段
  extra?: ChatMessageExtra;

  fileList?: ChatFileItem[];
  /**
   * this is a deprecated field, only use in client db
   * and should be remove after migrate to pglite
   * this field is replaced by fileList and imageList
   * @deprecated
   */
  files?: string[];
  groupId?: string;
  id: string;
  imageList?: ChatImageItem[];
  meta: MetaData;
  metadata?: MessageMetadata | null;
  /**
   * observation id
   */
  observationId?: string;
  /**
   * parent message id
   */
  parentId?: string;
  /**
   * Performance metrics (tps, ttft, duration, latency)
   * Aggregated from all children in group messages
   */
  performance?: ModelPerformance;
  plugin?: ChatPluginPayload;
  pluginError?: any;
  pluginState?: any;
  /**
   * quoted other message's id
   */
  quotaId?: string;
  ragQuery?: string | null;
  ragQueryId?: string | null;
  ragRawQuery?: string | null;
  reasoning?: ModelReasoning | null;
  /**
   * message role type
   */
  role: UIMessageRoleType;
  search?: GroundingSearch | null;
  sessionId?: string;
  /**
   * target member ID for DM messages in group chat
   */
  targetId?: string | null;
  threadId?: string | null;
  tool_call_id?: string;
  tools?: ChatToolPayload[];
  /**
   * 保存到主题的消息
   */
  topicId?: string;
  /**
   * 观测链路 id
   */
  traceId?: string;
  updatedAt: number;
  /**
   * Token usage and cost metrics
   * Aggregated from all children in group messages
   */
  usage?: ModelUsage;
  videoList?: ChatVideoItem[];
}
