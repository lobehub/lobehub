import type {
  ArtboardBoardView,
  ArtboardEdgeView,
  ArtboardGroupView,
  ArtboardPageView,
  ArtboardRoundView,
} from './artboard';

export const ARTBOARD_VIEWER_MAJOR = 1;

export const ARTBOARD_SNAPSHOT_ELEMENT_ID = 'artboard-snapshot';

export interface ArtboardPublishSource {
  kind: 'canvas' | 'image';
  src: string;
}

export interface ArtboardPublishBoard extends Omit<
  ArtboardBoardView,
  'expected' | 'flowNodeId' | 'source'
> {
  source: ArtboardPublishSource | null;
}

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
