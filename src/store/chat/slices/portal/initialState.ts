import { type PortalArtifact } from '@/types/artifact';

export enum ArtifactDisplayMode {
  Code = 'code',
  Preview = 'preview',
}

// ============== Portal View Stack Types ==============

export enum PortalViewType {
  Artifact = 'artifact',
  Document = 'document',
  FilePreview = 'filePreview',
  GroupThread = 'groupThread',
  Home = 'home',
  LocalFile = 'localFile',
  MessageDetail = 'messageDetail',
  Notebook = 'notebook',
  Thread = 'thread',
  ToolUI = 'toolUI',
}

export interface PortalFile {
  chunkId?: string;
  chunkText?: string;
  fileId: string;
}

export type PortalViewData =
  | { type: PortalViewType.Home }
  | { artifact: PortalArtifact; type: PortalViewType.Artifact }
  | { documentId: string; type: PortalViewType.Document }
  | { type: PortalViewType.Notebook }
  | { file: PortalFile; type: PortalViewType.FilePreview }
  | { type: PortalViewType.LocalFile }
  | { messageId: string; type: PortalViewType.MessageDetail }
  | { identifier: string; messageId: string; type: PortalViewType.ToolUI }
  | { startMessageId?: string; threadId?: string; type: PortalViewType.Thread }
  | { agentId: string; type: PortalViewType.GroupThread };

// ============== Portal State ==============

export interface ChatPortalState {
  /** Path of the currently active tab; undefined when no tabs open. */
  activeLocalFilePath?: string;

  // Legacy fields (kept for backward compatibility during migration)
  // TODO: Remove after Phase 3 migration complete
  /** Open file tabs in the LocalFile portal. */
  openLocalFiles: Array<{ filePath: string; workingDirectory: string }>;
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
  openLocalFiles: [],
  portalArtifactDisplayMode: ArtifactDisplayMode.Preview,
  portalStack: [],
  showPortal: false,
};
