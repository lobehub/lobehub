import { UploadFileItem } from '../files';
import { MetaData } from '../meta';
import { MessageSemanticSearchChunk } from '../rag';
import { GroundingSearch } from '../search';
import type { ChatMessageError, MessageMetadata, MessageRoleType, ModelReasoning } from './base';
import { ChatImageItem } from './image';
import { ChatPluginPayload, ChatToolPayload } from './tools';
import { Translate } from './translate';
import { ChatVideoItem } from './video';

export interface ChatTranslate extends Translate {
  content?: string;
}

export interface ChatTTS {
  contentMd5?: string;
  file?: string;
  voice?: string;
}

export interface ChatFileItem {
  content?: string;
  fileType: string;
  id: string;
  name: string;
  size: number;
  url: string;
}

export interface ChatFileChunk {
  fileId: string;
  fileType: string;
  fileUrl: string;
  filename: string;
  id: string;
  similarity?: number;
  text: string;
}

export interface ChatMessageExtra {
  fromModel?: string;
  fromProvider?: string;
  // 翻译
  translate?: ChatTranslate | false | null;
  // TTS
  tts?: ChatTTS;
}

export interface AssistantContentBlock {
  content: string;
  fileList?: ChatFileItem[];
  id: string;
  imageList?: ChatImageItem[];
  tools?: ChatToolPayload[];
}

export interface ChatMessage {
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
  role: MessageRoleType;
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
  videoList?: ChatVideoItem[];
}

export interface CreateMessageParams
  extends Partial<Omit<ChatMessage, 'content' | 'role' | 'topicId' | 'chunksList'>> {
  content: string;
  error?: ChatMessageError | null;
  fileChunks?: MessageSemanticSearchChunk[];
  files?: string[];
  fromModel?: string;
  fromProvider?: string;
  groupId?: string;
  role: MessageRoleType;
  sessionId: string;
  targetId?: string | null;
  threadId?: string | null;
  topicId?: string;
  traceId?: string;
}

export interface SendMessageParams {
  /**
   * create a thread
   */
  createThread?: boolean;
  files?: UploadFileItem[];
  /**
   *
   * https://github.com/lobehub/lobe-chat/pull/2086
   */
  isWelcomeQuestion?: boolean;
  message: string;
  /**
   * Additional metadata for the message (e.g., mentioned users)
   */
  metadata?: Record<string, any>;
  onlyAddUserMessage?: boolean;
}

export interface SendThreadMessageParams {
  /**
   * create a thread
   */
  createNewThread?: boolean;
  // files?: UploadFileItem[];
  message: string;
  onlyAddUserMessage?: boolean;
}

export interface SendGroupMessageParams {
  files?: UploadFileItem[];
  groupId: string;
  message: string;
  /**
   * Additional metadata for the message (e.g., mentioned users)
   */
  metadata?: Record<string, any>;
  onlyAddUserMessage?: boolean;
  /**
   * for group chat
   */
  targetMemberId?: string | null;
}
