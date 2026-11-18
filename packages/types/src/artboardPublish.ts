import type {
  ArtboardBoardView,
  ArtboardEdgeView,
  ArtboardGroupView,
  ArtboardPageView,
  ArtboardRoundView,
} from './artboard';

export const ARTBOARD_VIEWER_MAJOR = 1;

export const ARTBOARD_SNAPSHOT_ELEMENT_ID = 'artboard-snapshot';

/** Directory of the published site that holds the artboard's own files, keyed by their path. */
export const ARTBOARD_SITE_FILES_DIR = 'files/';

export type ArtboardPublishBoard = Omit<ArtboardBoardView, 'expected' | 'flowNodeId'>;

export type ArtboardPublishEdge = Omit<ArtboardEdgeView, 'flowEdgeId'>;

export type ArtboardPublishRound = Omit<ArtboardRoundView, 'batchId'>;

export interface ArtboardPublishSnapshot {
  boards: ArtboardPublishBoard[];
  description: string | null;
  edges: ArtboardPublishEdge[];
  groups: ArtboardGroupView[];
  pages: ArtboardPageView[];
  publishedAt: string;
  rounds: ArtboardPublishRound[];
  title: string;
  version: 1;
}
