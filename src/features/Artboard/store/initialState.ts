import type { CommentTarget } from '../data/commentActions';
import type { BoardMode, BoardTool, CameraTarget, CompareView, VerifyView } from '../types';

export interface CommentDraft extends CommentTarget {
  x: number;
  y: number;
}

export interface ArtboardState {
  boardId: string | null;
  camera: CameraTarget | null;
  compare: CompareView;
  draft: CommentDraft | null;
  flash: string[];
  fullscreen: boolean;
  gallery: boolean;
  mode: BoardMode;
  openThreadId: string | null;
  outlineOpen: boolean;
  pageByBoard: Record<string, string>;
  pageId: string | null;
  selected: string | null;
  tool: BoardTool;
  verifyOpen: boolean;
  verifyView: VerifyView;
}

export const initialState: ArtboardState = {
  boardId: null,
  camera: null,
  compare: 'real',
  draft: null,
  flash: [],
  fullscreen: false,
  gallery: false,
  mode: 'discuss',
  openThreadId: null,
  outlineOpen: false,
  pageByBoard: {},
  pageId: null,
  selected: null,
  tool: 'select',
  verifyOpen: true,
  verifyView: 'board',
};
