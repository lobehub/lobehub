import { type PortalArtifact } from '@/types/artifact';

export enum ArtifactDisplayMode {
  Code = 'code',
  Preview = 'preview',
}

export interface PortalFile {
  chunkId?: string;
  chunkText?: string;
  fileId: string;
}

export interface ChatPortalState {
  portalArtifact?: PortalArtifact;
  portalArtifactDisplayMode?: ArtifactDisplayMode;
  portalDocumentId?: string;
  portalFile?: PortalFile;
  portalMessageDetail?: string;
  portalThreadId?: string;
  portalToolMessage?: { id: string; identifier: string };
  showNotebook?: boolean;
  showPortal: boolean;
}

export const initialChatPortalState: ChatPortalState = {
  portalArtifactDisplayMode: ArtifactDisplayMode.Preview,
  showPortal: false,
};
