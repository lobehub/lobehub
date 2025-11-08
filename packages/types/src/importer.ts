import { LobeAgentConfig } from './agent';
import {
  ChatMessageError,
  ChatPluginPayload,
  ChatTTS,
  ChatToolPayload,
  ChatTranslate,
  UIMessageRoleType,
} from './message';
import { MetaData } from './meta';
import { SessionGroupId } from './session';

export interface ImportSession {
  config: LobeAgentConfig;
  createdAt: string;
  group?: SessionGroupId;
  id: string;
  meta: MetaData;
  pinned?: boolean;
  type: 'agent' | 'group';
  updatedAt: string;
}

export interface ImportMessage {
  content: string;
  createdAt: number;
  error?: ChatMessageError;

  // 扩展字段
  extra?: {
    fromModel?: string;
    fromProvider?: string;
    // 翻译
    translate?: ChatTranslate | false | null;
    // TTS
    tts?: ChatTTS;
  } & Record<string, any>;
  files?: string[];
  id: string;

  /**
   * observation id
   */
  observationId?: string;

  /**
   * parent message id
   */
  parentId?: string;
  plugin?: ChatPluginPayload;
  pluginState?: any;

  quotaId?: string;
  role: UIMessageRoleType;

  sessionId?: string;
  tool_call_id?: string;
  tools?: ChatToolPayload[];

  topicId?: string;
  traceId?: string;

  updatedAt: number;
}

export interface ImportSessionGroup {
  createdAt: number;
  id: string;
  name: string;
  sort?: number | null;
  updatedAt: number;
}
export interface ImportTopic {
  createdAt: number;
  favorite?: boolean;
  historySummary?: string;
  id: string;
  metadata?: {
    model?: string;
    provider?: string;
  };
  sessionId?: string;
  title: string;
  updatedAt: number;
}

export interface ImporterEntryData {
  messages?: ImportMessage[];
  sessionGroups?: ImportSessionGroup[];
  sessions?: ImportSession[];
  topics?: ImportTopic[];
  version: number;
}

export interface ImportResult {
  added: number;
  errors: number;
  skips: number;
}

export interface ImportResults {
  messages?: ImportResult;
  sessionGroups?: ImportResult;
  sessions?: ImportResult;
  topics?: ImportResult;
  type?: string;
}

export enum ImportStage {
  Start,
  Preparing,
  Uploading,
  Importing,
  Success,
  Error,
  Finished,
}

export interface FileUploadState {
  progress: number;
  /**
   * rest time in ms
   */
  restTime: number;
  /**
   * upload speed in KB/s
   */
  speed: number;
}

export interface ErrorShape {
  code: string;
  httpStatus: number;
  message: string;
  path?: string;
}

export interface OnImportCallbacks {
  onError?: (error: ErrorShape) => void;
  onFileUploading?: (state: FileUploadState) => void;
  onStageChange?: (stage: ImportStage) => void;
  /**
   *
   * @param results
   * @param duration in ms
   */
  onSuccess?: (results: ImportResults, duration: number) => void;
}

// ------

export type ImportResultData = ImportSuccessResult | ImportErrorResult;

export interface ImportSuccessResult {
  results: Record<string, any>;
  success: true;
}

export interface ImportErrorResult {
  error: { details?: string; message: string };
  results: Record<string, any>;
  success: false;
}
