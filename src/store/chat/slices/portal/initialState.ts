import { type PortalArtifact } from '@/types/artifact';

export enum ArtifactDisplayMode {
  Code = 'code',
  Preview = 'preview',
}

// ============== Portal View Stack Types ==============

export enum PortalViewType {
  Home = 'home',
  Artifact = 'artifact',
  Document = 'document',
  Notebook = 'notebook',
  FilePreview = 'filePreview',
  MessageDetail = 'messageDetail',
  ToolUI = 'toolUI',
  Thread = 'thread',
  GroupThread = 'groupThread',
}

export interface PortalFile {
  chunkId?: string;
  chunkText?: string;
  fileId: string;
}

export type PortalViewData =
  | { type: PortalViewType.Home }
  | { type: PortalViewType.Artifact; artifact: PortalArtifact }
  | { type: PortalViewType.Document; documentId: string }
  | { type: PortalViewType.Notebook }
  | { type: PortalViewType.FilePreview; file: PortalFile }
  | { type: PortalViewType.MessageDetail; messageId: string }
  | { type: PortalViewType.ToolUI; messageId: string; identifier: string }
  | { type: PortalViewType.Thread; threadId?: string; startMessageId?: string }
  | { type: PortalViewType.GroupThread; agentId: string };

// ============== Portal State ==============

export interface ChatPortalState {
  portalArtifactDisplayMode: ArtifactDisplayMode;
  portalStack: PortalViewData[];
  showPortal: boolean;

  // Legacy fields (kept for backward compatibility during migration)
  // TODO: Remove after Phase 3 migration complete
  /** @deprecated Use portalStack instead */
  portalArtifact?: PortalArtifact;
  /** @deprecated Use portalStack instead */
  portalDocumentId?: string;
  /** @deprecated Use portalStack instead */
  portalFile?: PortalFile;
  /** @deprecated Use portalStack instead */
  portalMessageDetail?: string;
  /** @deprecated Use portalStack instead */
  portalThreadId?: string;
  /** @deprecated Use portalStack instead */
  portalToolMessage?: { id: string; identifier: string };
  /** @deprecated Use portalStack instead */
  showNotebook?: boolean;
}

export const initialChatPortalState: ChatPortalState = {
  portalArtifactDisplayMode: ArtifactDisplayMode.Preview,
  portalStack: [],
  showPortal: false,
};
