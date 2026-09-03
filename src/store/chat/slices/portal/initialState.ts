import type { TopicCommentItem } from '@lobechat/types';

import { type PortalArtifact } from '@/types/artifact';

export enum ArtifactDisplayMode {
  Code = 'code',
  Preview = 'preview',
}

// ============== Portal View Stack Types ==============

export enum PortalViewType {
  Acceptance = 'acceptance',
  AcceptanceCheck = 'acceptanceCheck',
  AgentDetail = 'agentDetail',
  Artifact = 'artifact',
  Document = 'document',
  FilePreview = 'filePreview',
  GoalMetric = 'goalMetric',
  GoalNode = 'goalNode',
  GroupThread = 'groupThread',
  Home = 'home',
  LocalFile = 'localFile',
  MessageDetail = 'messageDetail',
  Notebook = 'notebook',
  TaskDetail = 'taskDetail',
  Thread = 'thread',
  ToolUI = 'toolUI',
  Topic = 'topic',
  TopicComments = 'topicComments',
  TopicCommentThread = 'topicCommentThread',
  VerifyReport = 'verifyReport',
  VerifyResult = 'verifyResult',
}

export interface PortalFile {
  chunkId?: string;
  chunkText?: string;
  fileId: string;
}

export interface OpenLocalFileParams {
  allowExternalFilePreview?: boolean;
  deviceId?: string;
  filePath: string;
  /**
   * Present when the file lives in the topic's cloud sandbox instead of a local
   * or device filesystem: content is fetched live via the sandbox
   * `readLocalFile` tool scoped to this topic, read-only, and unavailable once
   * the sandbox is recycled.
   */
  sandboxTopicId?: string;
  workingDirectory: string;
}

export interface OpenLocalFileEntry extends OpenLocalFileParams {
  id: string;
}

/**
 * Which header metric of the goal detail page a drill-down inspects. Every
 * value is derivable from the `goal.graph` snapshot the page already holds —
 * none of these views require server work.
 */
export type GoalMetricKind =
  'budget' | 'duration' | 'findings' | 'lifecycle' | 'liveness' | 'tasks';

export type PortalViewData =
  | { type: PortalViewType.Home }
  | { goalId: string; metric: GoalMetricKind; type: PortalViewType.GoalMetric }
  | { goalId: string; nodeId: string; type: PortalViewType.GoalNode }
  | { acceptanceId: string; type: PortalViewType.Acceptance }
  | { acceptanceId: string; checkId: string; type: PortalViewType.AcceptanceCheck }
  | { agentId: string; type: PortalViewType.AgentDetail }
  | { artifact: PortalArtifact; type: PortalViewType.Artifact }
  | { agentDocumentId?: string; documentId: string; type: PortalViewType.Document }
  | { type: PortalViewType.Notebook }
  | { file: PortalFile; type: PortalViewType.FilePreview }
  | { type: PortalViewType.LocalFile }
  | { messageId: string; type: PortalViewType.MessageDetail }
  | {
      identifier: string;
      messageId: string;
      params?: Record<string, any>;
      type: PortalViewType.ToolUI;
    }
  | { startMessageId?: string; threadId?: string; type: PortalViewType.Thread }
  | { topicId: string; type: PortalViewType.Topic }
  | { agentId: string; type: PortalViewType.GroupThread }
  | { taskId: string; type: PortalViewType.TaskDetail }
  | {
      focusCommentId?: string;
      initialReplyCount?: number;
      initialRoot?: TopicCommentItem;
      rootCommentId: string;
      topicId: string;
      type: PortalViewType.TopicCommentThread;
    }
  | { messageId?: string; topicId: string; type: PortalViewType.TopicComments }
  | { runId: string; type: PortalViewType.VerifyReport }
  | { checkItemId: string; operationId: string; type: PortalViewType.VerifyResult };

// ============== Portal State ==============

export interface ChatPortalState {
  /** Composite id of the currently active local-file tab; undefined when no tabs open. */
  activeLocalFileId?: string;

  /** Active local-file tab id keyed by project/root working directory. */
  activeLocalFileIdsByScope: Record<string, string>;

  /** Path of the currently active tab; kept for legacy consumers that only need display/open path. */
  activeLocalFilePath?: string;

  /** Unsaved edit buffers keyed by file path. Presence implies the file is dirty. */
  dirtyLocalFileContents: Record<string, string>;

  // Legacy fields (kept for backward compatibility during migration)
  // TODO: Remove after Phase 3 migration complete
  /** Open file tabs in the LocalFile portal. */
  openLocalFiles: OpenLocalFileEntry[];
  /** @deprecated Use portalStack instead */
  portalArtifact?: PortalArtifact;
  portalArtifactDisplayMode: ArtifactDisplayMode;
  /** @deprecated Use portalStack instead */
  portalDocumentId?: string;

  /** @deprecated Use portalStack instead */
  portalFile?: PortalFile;
  /** @deprecated Use portalStack instead */
  portalMessageDetail?: string;
  portalStack: PortalViewData[];
  /** @deprecated Use portalStack instead */
  portalThreadId?: string;
  /** @deprecated Use portalStack instead */
  portalToolMessage?: { id: string; identifier: string };
  /** @deprecated Use portalStack instead */
  showNotebook?: boolean;
  showPortal: boolean;
}

export const initialChatPortalState: ChatPortalState = {
  activeLocalFileIdsByScope: {},
  dirtyLocalFileContents: {},
  openLocalFiles: [],
  portalArtifactDisplayMode: ArtifactDisplayMode.Preview,
  portalStack: [],
  showPortal: false,
};
