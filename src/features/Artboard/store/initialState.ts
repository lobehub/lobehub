import type { ArtboardReference } from '@/features/ChatInput/InputEditor/ReferArtboard/serialize';

import type { BoardMode, CameraTarget, VerifyView } from '../types';

export interface DragPosition {
  id: string;
  x: number;
  y: number;
}

export interface GalleryConversation {
  agentId: string;
  topicId: string;
}

export interface ArtboardState {
  boardId: string | null;
  camera: CameraTarget | null;
  drag: DragPosition | null;
  flash: string[];
  fullscreen: boolean;
  gallery: GalleryConversation | null;
  galleryRefs: ArtboardReference[];
  mode: BoardMode;
  outlineOpen: boolean;
  selected: string | null;
  showReal: boolean;
  staleRevision: number | null;
  verifyOpen: boolean;
  verifyView: VerifyView;
}

export const initialState: ArtboardState = {
  boardId: null,
  camera: null,
  drag: null,
  flash: [],
  fullscreen: false,
  gallery: null,
  galleryRefs: [],
  mode: 'discuss',
  outlineOpen: false,
  selected: null,
  showReal: false,
  staleRevision: null,
  verifyOpen: true,
  verifyView: 'flow',
};
