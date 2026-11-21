import type { CanvasChangeSet, CanvasFileWrite, CanvasIssue } from '@lobechat/canvas';
import type { CanvasWorkVersionMetadata } from '@lobechat/types';

export const CanvasIdentifier = 'lobe-canvas';

export const CanvasApiName = {
  createCanvas: 'createCanvas',
  listCanvases: 'listCanvases',
  readCanvas: 'readCanvas',
  readCanvasGuide: 'readCanvasGuide',
  updateCanvas: 'updateCanvas',
} as const;

export type CanvasApiNameType = (typeof CanvasApiName)[keyof typeof CanvasApiName];

export interface CreateCanvasParams {
  description?: string;
  files: CanvasFileWrite[];
  title: string;
}

export interface UpdateCanvasParams extends CanvasChangeSet {
  canvasId: string;
  description?: string;
  title?: string;
}

export interface ReadCanvasParams {
  canvasId: string;
  paths?: string[];
}

export interface CanvasFileSummary {
  path: string;
  size: number;
}

export interface CanvasSummary {
  canvasId: string;
  description: string | null;
  title: string | null;
  updatedAt: string;
}

export type CanvasSaveOutcome =
  | { error?: string; issues: CanvasIssue[]; ok: false }
  | {
      canvasId: string;
      description: string | null;
      metadata: CanvasWorkVersionMetadata;
      ok: true;
      title: string;
    };

export interface CanvasReadOutcome {
  canvasId: string;
  description: string | null;
  files: CanvasFileSummary[];
  texts: { content: string; path: string }[];
  title: string | null;
}

export interface CanvasLinks {
  /** Opens the Canvas in its conversation; needs a signed-in user with access. */
  openUrl?: string;
  /** Public link from the user's last share; it can lag behind the latest save. */
  publishedUrl?: string;
}

export interface CanvasSaveState extends CanvasLinks {
  canvasId?: string;
  issues?: CanvasIssue[];
  metadata?: CanvasWorkVersionMetadata;
  title?: string;
}
