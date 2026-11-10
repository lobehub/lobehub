export const ARTBOARD_PHASES = ['discuss', 'finalized'] as const;
export type ArtboardPhase = (typeof ARTBOARD_PHASES)[number];

export const ARTBOARD_GROUP_KINDS = ['journey', 'options', 'references', 'other'] as const;
export type ArtboardGroupKind = (typeof ARTBOARD_GROUP_KINDS)[number];

export const ARTBOARD_ROUND_STATUSES = ['open', 'submitted'] as const;
export type ArtboardRoundStatus = (typeof ARTBOARD_ROUND_STATUSES)[number];

export const ARTBOARD_DEFAULT_PAGE_NAME = 'Page 1';

export interface ArtboardEdgeMetadata {
  condition?: string;
}

export interface ArtboardMetadata {}
export interface ArtboardPageMetadata {}
export interface ArtboardRoundMetadata {}
export interface ArtboardGroupMetadata {}
export interface ArtboardBoardMetadata {}
export interface ArtboardCommentMetadata {}
