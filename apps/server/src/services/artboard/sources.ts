import { createMediaFileItemsFromMessage } from '@lobechat/builtin-tool-lobe-agent';
import type { ArtboardBoardSourceInput, ArtboardOp } from '@lobechat/types';
import pMap from 'p-map';

import {
  resolveArtifactDeploymentRelease,
  type ResolveArtifactDeploymentReleaseResult,
} from '@/business/server/artifactDeployment';
import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { WorkModel } from '@/database/models/work';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

import { ArtboardServiceError } from './errors';

export const ARTBOARD_SOURCE_CONCURRENCY = 5;

export interface ArtboardCanvasInfo {
  title: string;
  version: number;
}

export interface ArtboardCanvasRef {
  canvasId: string;
  version: number;
}

/** What a `dep_…` id stands for when this database already knows it. */
export type ArtboardKnownDeployment =
  { canvasId: string; kind: 'canvas'; publishedVersion: number } | { kind: 'artboard' };

export interface ArtboardSourceResolver {
  canvas: (canvasId: string) => Promise<ArtboardCanvasInfo | undefined>;
  canvasVersionId: (canvasId: string, version: number) => Promise<string | undefined>;
  canvasVersions: (versionIds: string[]) => Promise<Record<string, ArtboardCanvasRef>>;
  deploymentRelease: (
    deploymentId: string,
    revision?: number,
  ) => Promise<ResolveArtifactDeploymentReleaseResult>;
  image: (fileRef: string) => Promise<string | undefined>;
  imageUrl: (fileId: string) => Promise<string | undefined>;
  /** A deployment published from a Canvas or an artboard of the caller's. */
  knownDeployment: (deploymentId: string) => Promise<ArtboardKnownDeployment | undefined>;
}

export interface ArtboardSourceScope {
  agentId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
  workspaceId?: string;
}

export type ResolvedBoardSource =
  | { kind: 'canvas'; path: string | null; workVersionId: string }
  | { deploymentId: string; kind: 'deployment'; releaseId: string; revision: number }
  | { fileId: string; kind: 'image' };

type WithResolvedSource<T> = T extends { board: infer B }
  ? Omit<T, 'board'> & { board: Omit<B, 'source'> & { source?: ResolvedBoardSource } }
  : T extends { patch: infer P; type: 'updateBoard' }
    ? Omit<T, 'patch'> & { patch: Omit<P, 'source'> & { source?: ResolvedBoardSource } }
    : T;

export type ResolvedArtboardOp = WithResolvedSource<ArtboardOp>;

const MEDIA_REF_PATTERN = /^msg_[\da-z]+\.(?:audio|image|video)_\d+$/;

const SHARE_LINK_PATTERN = /\/share\/artifact\/([^\s#/?]+)/;
const DEPLOYMENT_ID_PATTERN = /^[\w-]+$/;

/** A `dep_…` id, or the id inside an `/share/artifact/<id>` link. */
export const parseDeploymentRef = (ref: string): string | undefined => {
  const trimmed = ref.trim();
  const linked = SHARE_LINK_PATTERN.exec(trimmed)?.[1];
  if (linked) return decodeURIComponent(linked);
  return DEPLOYMENT_ID_PATTERN.test(trimmed) ? trimmed : undefined;
};

export const createArtboardSourceResolver = (
  db: LobeChatDatabase,
  scope: ArtboardSourceScope,
): ArtboardSourceResolver => {
  const { userId, workspaceId } = scope;
  const files = new FileModel(db, userId, workspaceId);
  const works = new WorkModel(db, userId, workspaceId);
  let mediaFileIds: Promise<Map<string, string>> | undefined;

  const listMediaFileIds = async () => {
    if (!scope.topicId) return new Map<string, string>();
    const messages = await new MessageModel(db, userId, workspaceId).query({
      agentId: scope.agentId ?? undefined,
      skipWorks: true,
      threadId: scope.threadId ?? undefined,
      topicId: scope.topicId,
    });
    return new Map(
      messages
        .flatMap((message) => createMediaFileItemsFromMessage(message))
        .flatMap((item) => (item.id ? [[item.ref, item.id] as const] : [])),
    );
  };

  return {
    canvas: async (canvasId) => {
      const found = await works.findCanvas(canvasId);
      return found
        ? { title: found.work.title ?? canvasId, version: found.version.version }
        : undefined;
    },
    canvasVersionId: async (canvasId, version) =>
      (await works.findCanvasVersionId(canvasId, version)) ?? undefined,
    canvasVersions: (versionIds) => works.findCanvasSourcesByVersionIds(versionIds),
    deploymentRelease: (deploymentId, revision) =>
      resolveArtifactDeploymentRelease({ db, deploymentId, revision, userId, workspaceId }),
    knownDeployment: async (deploymentId) => {
      const canvasId = (await works.findCanvasIdsByDeploymentIds([deploymentId]))[deploymentId];
      if (canvasId) {
        const found = await works.findCanvas(canvasId);
        const publishedVersion = found?.work.metadata?.canvasPublish?.publishedVersion;
        if (publishedVersion) return { canvasId, kind: 'canvas', publishedVersion };
      }
      const artboards = await works.findArtboardIdsByDeploymentIds([deploymentId]);
      return artboards[deploymentId] ? { kind: 'artboard' } : undefined;
    },
    image: async (fileRef) => {
      let fileId: string | undefined = fileRef;
      if (MEDIA_REF_PATTERN.test(fileRef)) {
        const pending = (mediaFileIds ??= listMediaFileIds());
        fileId = (await pending).get(fileRef);
      }
      if (!fileId) return;
      const file = await files.findById(fileId);
      return file?.fileType.startsWith('image/') ? file.id : undefined;
    },
    imageUrl: async (fileId) => {
      const file = await files.findById(fileId);
      if (!file) return;
      return new FileService(db, userId, workspaceId).getFileAccessUrl({
        id: file.id,
        url: file.url,
      });
    },
  };
};

const resolveSource = async (
  source: ArtboardBoardSourceInput,
  sources: ArtboardSourceResolver,
  opIndex: number,
): Promise<ResolvedBoardSource> => {
  if (source.kind === 'image') {
    const fileId = await sources.image(source.fileRef);
    if (!fileId)
      throw new ArtboardServiceError(
        'source_denied',
        `fileRef "${source.fileRef}" does not match an image you can access. Use a file id from <file id> or an image ref from <image ref> in this conversation.`,
        { opIndex },
      );
    return { fileId, kind: 'image' };
  }

  if (source.kind === 'deployment') return resolveDeploymentSource(source, sources, opIndex);

  return resolveCanvasSource(source, sources, opIndex);
};

const resolveCanvasSource = async (
  source: { canvasId: string; path?: string; version?: number },
  sources: ArtboardSourceResolver,
  opIndex: number,
): Promise<ResolvedBoardSource> => {
  const canvas = await sources.canvas(source.canvasId);
  if (!canvas)
    throw new ArtboardServiceError(
      'source_denied',
      `Canvas "${source.canvasId}" was not found or you cannot access it.`,
      { opIndex },
    );
  const version = source.version ?? canvas.version;
  const workVersionId =
    version > canvas.version ? undefined : await sources.canvasVersionId(source.canvasId, version);
  if (!workVersionId)
    throw new ArtboardServiceError(
      'invalid',
      `Canvas "${source.canvasId}" has no version ${version}; its latest is ${canvas.version}.`,
      { opIndex },
    );
  return { kind: 'canvas', path: source.path ?? null, workVersionId };
};

const resolveDeploymentSource = async (
  source: { deployment: string; revision?: number },
  sources: ArtboardSourceResolver,
  opIndex: number,
): Promise<ResolvedBoardSource> => {
  const deploymentId = parseDeploymentRef(source.deployment);
  if (!deploymentId)
    throw new ArtboardServiceError(
      'invalid',
      `"${source.deployment}" is not a deployment. Pass its dep_… id or its /share/artifact/<id> link.`,
      { opIndex },
    );

  const known = await sources.knownDeployment(deploymentId);
  if (known?.kind === 'artboard')
    throw new ArtboardServiceError(
      'invalid',
      `Deployment "${deploymentId}" is a shared artboard, not a page a board can show.`,
      { opIndex },
    );
  if (known?.kind === 'canvas') {
    // A published Canvas keeps its versions here, so the board pins the published one.
    if (source.revision !== undefined)
      throw new ArtboardServiceError(
        'invalid',
        `Deployment "${deploymentId}" is Canvas ${known.canvasId}. Pick its version with {kind:"canvas", canvasId:"${known.canvasId}", version} instead of a revision.`,
        { opIndex },
      );
    return resolveCanvasSource(
      { canvasId: known.canvasId, version: known.publishedVersion },
      sources,
      opIndex,
    );
  }

  const result = await sources.deploymentRelease(deploymentId, source.revision);
  switch (result.status) {
    case 'ok': {
      const { releaseId, revision } = result.release;
      return { deploymentId: result.release.deploymentId, kind: 'deployment', releaseId, revision };
    }
    case 'revision_not_found': {
      throw new ArtboardServiceError(
        'invalid',
        `Deployment "${deploymentId}" has no revision ${source.revision}; its latest is ${result.latestRevision}.`,
        { opIndex },
      );
    }
    case 'not_html': {
      throw new ArtboardServiceError(
        'invalid',
        `Deployment "${deploymentId}" is not an HTML page a board can show.`,
        { opIndex },
      );
    }
    case 'not_found': {
      throw new ArtboardServiceError(
        'source_denied',
        `Deployment "${deploymentId}" was not found or you cannot access it.`,
        { opIndex },
      );
    }
    case 'unavailable': {
      throw new ArtboardServiceError(
        'invalid',
        'Hosted HTML deployments are not available here. Show the page through a Canvas instead.',
        { opIndex },
      );
    }
  }
};

export const resolveOpSources = (
  ops: ArtboardOp[],
  sources: ArtboardSourceResolver,
): Promise<ResolvedArtboardOp[]> =>
  pMap(
    ops,
    async (op, index): Promise<ResolvedArtboardOp> => {
      if (op.type === 'addBoard') {
        const { source, ...board } = op.board;
        return {
          ...op,
          board: source ? { ...board, source: await resolveSource(source, sources, index) } : board,
        };
      }
      if (op.type === 'updateBoard') {
        const { source, ...patch } = op.patch;
        return {
          ...op,
          patch: source ? { ...patch, source: await resolveSource(source, sources, index) } : patch,
        };
      }
      return op;
    },
    { concurrency: ARTBOARD_SOURCE_CONCURRENCY },
  );
