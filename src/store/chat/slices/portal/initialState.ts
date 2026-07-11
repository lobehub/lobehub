import { type PortalArtifact } from '@/types/artifact';

export enum ArtifactDisplayMode {
  Code = 'code',
  Preview = 'preview',
}

// ============== Portal View Stack Types ==============

export enum PortalViewType {
  AgentDetail = 'agentDetail',
  Artifact = 'artifact',
  Document = 'document',
  FilePreview = 'filePreview',
  GroupThread = 'groupThread',
  Home = 'home',
  LocalFile = 'localFile',
  MessageDetail = 'messageDetail',
  Notebook = 'notebook',
  TaskDetail = 'taskDetail',
  Thread = 'thread',
  ToolUI = 'toolUI',
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
  workingDirectory: string;
}

export interface OpenLocalFileEntry extends OpenLocalFileParams {
  id: string;
}

export type PortalViewData =
  | { type: PortalViewType.Home }
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
  | { agentId: string; type: PortalViewType.GroupThread }
  | { taskId: string; type: PortalViewType.TaskDetail }
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
