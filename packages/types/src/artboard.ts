export const ARTBOARD_PHASES = ['discuss', 'finalized'] as const;
export type ArtboardPhase = (typeof ARTBOARD_PHASES)[number];

export const ARTBOARD_GROUP_KINDS = ['journey', 'options', 'references', 'other'] as const;
export type ArtboardGroupKind = (typeof ARTBOARD_GROUP_KINDS)[number];

export const ARTBOARD_ROUND_STATUSES = ['open', 'submitted'] as const;
export type ArtboardRoundStatus = (typeof ARTBOARD_ROUND_STATUSES)[number];

export const ARTBOARD_BOARD_TYPES = ['html', 'image', 'video', 'decision'] as const;
export type ArtboardBoardType = (typeof ARTBOARD_BOARD_TYPES)[number];

export const ARTBOARD_DEFAULT_PAGE_NAME = 'Page 1';

// A group's rect is in page coordinates and its top-left is the origin for the boards inside it;
// a board outside any group is in page coordinates.
export interface ArtboardRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export type ArtboardCommentAnchor =
  | { type: 'canvas'; x: number; y: number }
  // offsetX / offsetY are fractions (0–1) of the hit element's width and height.
  | { nodePath: string; offsetX: number; offsetY: number; type: 'node' };

export interface ArtboardEdgeMetadata {}

export interface ArtboardMetadata {}
export interface ArtboardPageMetadata {}
export interface ArtboardRoundMetadata {
  batchId?: string;
}
export interface ArtboardGroupMetadata {}
export interface ArtboardBoardMetadata {}
export interface ArtboardCommentMetadata {}
