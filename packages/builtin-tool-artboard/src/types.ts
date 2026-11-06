import type { ArtboardContent, ArtboardPhase } from '@lobechat/types';

export const ArtboardIdentifier = 'lobe-artboard';

export const ArtboardApiName = {
  createArtboard: 'createArtboard',
  listArtboards: 'listArtboards',
  readArtboard: 'readArtboard',
  updateArtboard: 'updateArtboard',
} as const;

export type ArtboardApiNameType = (typeof ArtboardApiName)[keyof typeof ArtboardApiName];

export interface CreateArtboardParams {
  description?: string;
  ops?: unknown[];
  taskId?: string;
  title: string;
}

export interface UpdateArtboardParams {
  id: string;
  ops: unknown[];
  revision: number;
}

export interface ReadArtboardParams {
  id: string;
}

export interface ArtboardToolSnapshot {
  content: ArtboardContent;
  description: string | null;
  id: string;
  phase: ArtboardPhase;
  projectId: string | null;
  revision: number;
  taskId: string;
  title: string;
}

export interface ArtboardToolFailure {
  code: string;
  message: string;
  ok: false;
}

export type ArtboardToolWriteOutcome =
  | {
      artboard: ArtboardToolSnapshot;
      changedIds: string[];
      ok: true;
      task?: { createdTask: boolean; identifier: string };
    }
  | ArtboardToolFailure;

export type ArtboardToolReadOutcome =
  | {
      artboard: ArtboardToolSnapshot;
      canvases: Record<string, { latestVersion: number; title: string } | null>;
      ok: true;
      staleFrameIds: string[];
    }
  | ArtboardToolFailure;

export type ArtboardToolListOutcome =
  | {
      artboards: Pick<ArtboardToolSnapshot, 'id' | 'phase' | 'revision' | 'taskId' | 'title'>[];
      ok: true;
    }
  | ArtboardToolFailure;

export interface ArtboardToolService {
  create: (params: CreateArtboardParams) => Promise<ArtboardToolWriteOutcome>;
  list: () => Promise<ArtboardToolListOutcome>;
  read: (params: ReadArtboardParams) => Promise<ArtboardToolReadOutcome>;
  update: (params: UpdateArtboardParams) => Promise<ArtboardToolWriteOutcome>;
}

export interface ArtboardToolState {
  artboardId: string;
  changedIds: string[];
  frameCount: number;
  groupCount: number;
  phase: ArtboardPhase;
  revision: number;
  title: string;
}
