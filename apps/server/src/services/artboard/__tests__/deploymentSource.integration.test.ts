// @vitest-environment node
import type { ResolveArtifactDeploymentReleaseResult } from '@lobechat/business-server/artifactDeployment';
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import type { ArtboardBoardSourceInput, ArtboardOp } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkModel } from '@/database/models/work';
import { artboardBoards, projects, topics, users } from '@/database/schemas';

import { ArtboardServiceError } from '../errors';
import { ArtboardService } from '../index';
import {
  type ArtboardSourceResolver,
  createArtboardSourceResolver,
  parseDeploymentRef,
} from '../sources';

const userId = 'artboard-deployment-user';
const projectId = 'prj_artboard_deployment';
const topicId = 'tpc_artboard_deployment';
const context = { topicId };

const db: LobeChatDatabase = await getTestDB();

// Releases a hosting service would report for `dep_page`.
const RELEASES = [
  { releaseId: 'rel_11', revision: 1 },
  { releaseId: 'rel_12', revision: 2 },
];

const hostedRelease = async (
  deploymentId: string,
  revision?: number,
): Promise<ResolveArtifactDeploymentReleaseResult> => {
  if (deploymentId === 'dep_doc') return { status: 'not_html' };
  if (deploymentId !== 'dep_page') return { status: 'not_found' };
  const latest = RELEASES.at(-1)!;
  const release = revision === undefined ? latest : RELEASES.find((r) => r.revision === revision);
  if (!release) return { latestRevision: latest.revision, status: 'revision_not_found' };
  return { release: { ...release, deploymentId, title: 'Pricing page' }, status: 'ok' };
};

const hosted: ArtboardSourceResolver = {
  ...createArtboardSourceResolver(db, { userId }),
  deploymentRelease: hostedRelease,
};

const service = (sources: ArtboardSourceResolver = hosted) =>
  new ArtboardService(db, userId, undefined, { context: { agentId: null }, sources });

const pageBoardOps = (source: ArtboardBoardSourceInput): ArtboardOp[] => [
  { group: { kind: 'references', title: '参考' }, ref: 'r', type: 'addGroup' },
  { board: { groupId: 'r', source, title: '定价页', x: 0, y: 0 }, ref: 'p', type: 'addBoard' },
];

const createWith = (source: ArtboardBoardSourceInput, sources?: ArtboardSourceResolver) =>
  service(sources).create({ ops: pageBoardOps(source), title: '画板' }, context);

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ArtboardServiceError) return error;
    throw error;
  }
  throw new Error('expected an ArtboardServiceError');
};

const registerCanvas = (canvasId: string) =>
  new WorkModel(db, userId).registerCanvas({
    canvasId,
    metadata: {
      entry: 'index.html',
      fileCount: 1,
      manifestKey: `canvas/${canvasId}/${Date.now()}-${Math.random()}.json`,
      runtimeMajor: 1,
      totalSize: 1,
    },
    title: canvasId,
    toolIdentifier: 'lobe-canvas',
    toolName: 'createCanvas',
  });

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
  await db.insert(projects).values({ id: projectId, name: 'Pricing', userId });
  await db.insert(topics).values({ id: topicId, projectId, title: '定价', userId });
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe('parseDeploymentRef', () => {
  it('takes a dep id or the id inside a share link, and nothing else', () => {
    expect(parseDeploymentRef(' dep_page ')).toBe('dep_page');
    expect(parseDeploymentRef('https://app.lobehub.com/share/artifact/dep_page?x=1')).toBe(
      'dep_page',
    );
    expect(parseDeploymentRef('https://pricing.lobe.page/')).toBeUndefined();
    expect(parseDeploymentRef('two words')).toBeUndefined();
  });
});

describe('ArtboardService deployment sources', () => {
  it('pins a hosted page at its latest release and stores the release on the board', async () => {
    const { artboard } = await createWith({
      deployment: 'https://app.lobehub.com/share/artifact/dep_page',
      kind: 'deployment',
    });

    const [board] = artboard.content.boards;
    expect(board).toMatchObject({
      source: { deploymentId: 'dep_page', kind: 'deployment', releaseId: 'rel_12', revision: 2 },
      type: 'html',
    });
    const [row] = await db.select().from(artboardBoards).where(eq(artboardBoards.id, board.id));
    expect(row).toMatchObject({
      sourceDeploymentId: 'dep_page',
      sourceDeploymentReleaseId: 'rel_12',
      sourceDeploymentRevision: 2,
      sourceFileId: null,
      sourceWorkVersionId: null,
    });
  });

  it('marks a comment stale once its board moves to another release', async () => {
    const { artboard } = await createWith({ deployment: 'dep_page', kind: 'deployment' });
    const [board] = artboard.content.boards;
    await service().addComment(artboard.id, {
      boardId: board.id,
      clientId: 'c1',
      content: '价格太小',
    });
    expect((await service().listComments(artboard.id))[0].stale).toBe(false);

    await service().update(artboard.id, artboard.revision, [
      {
        id: board.id,
        patch: { source: { deployment: 'dep_page', kind: 'deployment', revision: 1 } },
        type: 'updateBoard',
      },
    ]);

    const { artboard: read } = await service().read(artboard.id);
    expect(read.content.boards[0].source).toMatchObject({ releaseId: 'rel_11', revision: 1 });
    expect((await service().listComments(artboard.id))[0].stale).toBe(true);
  });

  it('places a published Canvas at its published version and refuses a revision for it', async () => {
    await registerCanvas('cvs_pub');
    await registerCanvas('cvs_pub');
    await new WorkModel(db, userId).recordCanvasPublish('cvs_pub', {
      deploymentId: 'dep_cvs',
      publishedVersion: 1,
      url: 'https://pub.lobe.page',
    });

    const { artboard } = await createWith({ deployment: 'dep_cvs', kind: 'deployment' });
    expect(artboard.content.boards[0].source).toEqual({
      canvasId: 'cvs_pub',
      kind: 'canvas',
      version: 1,
    });

    const refused = await errorOf(
      createWith({ deployment: 'dep_cvs', kind: 'deployment', revision: 2 }),
    );
    expect(refused).toMatchObject({ code: 'invalid', data: { opIndex: 1 } });
    expect(refused.message).toContain('cvs_pub');
  });

  it('explains every deployment it cannot place', async () => {
    const missingRevision = await errorOf(
      createWith({ deployment: 'dep_page', kind: 'deployment', revision: 9 }),
    );
    expect(missingRevision.message).toContain('its latest is 2');

    expect(await errorOf(createWith({ deployment: 'dep_gone', kind: 'deployment' }))).toMatchObject(
      { code: 'source_denied' },
    );
    expect(
      (await errorOf(createWith({ deployment: 'dep_doc', kind: 'deployment' }))).message,
    ).toContain('not an HTML page');
    expect(
      (await errorOf(createWith({ deployment: 'https://pricing.lobe.page/', kind: 'deployment' })))
        .message,
    ).toContain('dep_… id');
  });

  it('refuses a hosted page where nothing is hosted', async () => {
    const refused = await errorOf(
      createWith(
        { deployment: 'dep_page', kind: 'deployment' },
        createArtboardSourceResolver(db, { userId }),
      ),
    );
    expect(refused).toMatchObject({ code: 'invalid' });
    expect(refused.message).toContain('not available here');
    expect(await db.select().from(artboardBoards)).toEqual([]);
  });
});
