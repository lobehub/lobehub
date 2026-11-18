import { createHash } from 'node:crypto';

import type {
  ArtboardBoardSource,
  ArtboardItem,
  ArtboardPublishSnapshot,
  ArtboardPublishSource,
} from '@lobechat/types';

import { withoutDraftPicks } from '../view';

export const canvasSitePrefix = (canvasId: string, version: number) =>
  `canvases/${canvasId}/v${version}`;

export const imageSitePath = (fileId: string) => `images/${fileId}`;

export const deploymentSitePath = (deploymentId: string, revision: number) =>
  `deployments/${deploymentId}/r${revision}/index.html`;

const toSiteSource = (source: ArtboardBoardSource | null): ArtboardPublishSource | null => {
  if (!source) return null;
  if (source.kind === 'image') return { kind: 'image', src: imageSitePath(source.fileId) };
  if (source.kind === 'deployment')
    return { kind: 'deployment', src: deploymentSitePath(source.deploymentId, source.revision) };
  return {
    kind: 'canvas',
    src: `${canvasSitePrefix(source.canvasId, source.version)}/${source.path ?? 'index.html'}`,
  };
};

export const buildArtboardPublishSnapshot = (
  artboard: ArtboardItem,
  { publishedAt }: { publishedAt: string },
): ArtboardPublishSnapshot => {
  const { content } = withoutDraftPicks(artboard);
  return {
    boards: content.boards.map((board) => ({
      groupId: board.groupId,
      id: board.id,
      pageId: board.pageId,
      rect: board.rect,
      roundId: board.roundId,
      source: toSiteSource(board.source),
      title: board.title,
      type: board.type,
    })),
    description: artboard.description,
    edges: content.edges.map((edge) => ({
      condition: edge.condition,
      from: edge.from,
      id: edge.id,
      isDefault: edge.isDefault,
      label: edge.label,
      to: edge.to,
    })),
    groups: content.groups,
    pages: content.pages,
    publishedAt,
    rounds: content.rounds.map((round) => ({
      chosenBoardId: round.chosenBoardId,
      id: round.id,
      pageId: round.pageId,
      recommendedBoardId: round.recommendedBoardId,
      status: round.status,
      title: round.title,
    })),
    title: artboard.title,
    version: 1,
  };
};

export const hashArtboardSnapshot = ({ publishedAt: _, ...rest }: ArtboardPublishSnapshot) =>
  createHash('sha256').update(JSON.stringify(rest)).digest('hex');
