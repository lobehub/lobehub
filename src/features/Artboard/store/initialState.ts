import type { BoardMode, BoardTool, CameraTarget, VerifyView } from '../types';

export interface ArtboardState {
  boardId: string | null;
  camera: CameraTarget | null;
  flash: string[];
  fullscreen: boolean;
  gallery: boolean;
  mode: BoardMode;
  openThreadId: string | null;
  outlineOpen: boolean;
  pageByBoard: Record<string, string>;
  pageId: string | null;
  selected: string | null;
  showReal: boolean;
  staleRevision: number | null;
  tool: BoardTool;
  verifyOpen: boolean;
  verifyView: VerifyView;
}

export const initialState: ArtboardState = {
  boardId: null,
  camera: null,
  flash: [],
  fullscreen: false,
  gallery: false,
  mode: 'discuss',
  openThreadId: null,
  outlineOpen: false,
  pageByBoard: {},
  pageId: null,
  selected: null,
  showReal: false,
  staleRevision: null,
  tool: 'select',
  verifyOpen: true,
  verifyView: 'flow',
};
