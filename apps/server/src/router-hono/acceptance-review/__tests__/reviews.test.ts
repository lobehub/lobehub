// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  files,
  projects,
  users,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import { ProjectMemberModel } from '@/database/models/projectReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { ProjectReviewService } from '@/server/services/projectReview';

let serverDB: LobeChatDatabase;

const mocks = vi.hoisted(() => ({ submit: vi.fn(), upload: vi.fn(), uploaderId: '' }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  verifyAcceptanceReviewJWT: async (token: string) => {
    const [userId, siteId, origin] = token.split('|');
    if (!origin) throw new Error('invalid');
    return {
      clientId: 'lobehub-acceptance',
      expiresAt: 2_000_000_000,
      site: { origin, siteId },
      userId,
    };
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (url: string) => `https://cdn.example.com/${url}`;
    removeUnreferencedFile = vi.fn();
    uploadFromBuffer = mocks.upload;
  },
}));
vi.mock('@/server/services/acceptanceReview/submitReview', () => ({
  submitReviewRound: mocks.submit,
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));

const { default: app } = await import('../index');

const BASE = 'http://localhost/api/acceptance-review/v1';
const ORIGIN = 'https://fieldnotes.app';
const JPEG = `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`;

let ownerId: string;
let memberId: string;
let site: { acceptanceId: string | null; id: string };

const call = (userId: string, path: string, init: { json?: unknown; method?: string } = {}) =>
  app.request(`${BASE}${path}`, {
    body: init.json === undefined ? undefined : JSON.stringify(init.json),
    headers: {
      'authorization': `Bearer ${userId}|${site.id}|${ORIGIN}`,
      'content-type': 'application/json',
      'origin': ORIGIN,
    },
    method: init.method ?? 'GET',
  });

const mark = (clientId = randomUUID()) => ({
  clientId,
  content: '卡片标题和正文之间太挤了',
  kind: 'region',
  pageMeta: { title: 'Fieldnotes' },
  rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
  rectViewport: { height: 160, width: 384, x: 448, y: 494 },
  regionRefs: [{ box: { height: 0.5, width: 1, x: 0, y: 0.25 }, selector: 'article:nth-child(2)' }],
  routeKey: '/notebook',
  scroll: { x: 0, y: 800 },
  targets: [
    {
      label: 'article',
      rect: { height: 160, width: 384, x: 448, y: 494 },
      selector: 'article:nth-child(2)',
    },
  ],
  url: `${ORIGIN}/notebook`,
  viewport: { dpr: 2, height: 800, width: 1280 },
});

const start = async (userId: string) => {
  const response = await call(userId, '/reviews', { json: {}, method: 'POST' });
  return { body: await response.json(), status: response.status };
};

beforeEach(async () => {
  serverDB = await getTestDB();
  ownerId = await createTestUser(serverDB);
  memberId = await createTestUser(serverDB);
  await serverDB.update(users).set({ fullName: 'Innei' }).where(eq(users.id, ownerId));
  const [workspace] = await serverDB
    .insert(workspaces)
    .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: ownerId })
    .returning();
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId: workspace.id },
    { role: 'member', userId: memberId, workspaceId: workspace.id },
  ]);
  const projectId = (
    await new ProjectModel(serverDB, ownerId, workspace.id).create({
      identifier: 'SITE',
      name: 'Fieldnotes 官网',
    })
  ).id;
  await new ProjectMemberModel(serverDB).add({ projectId, role: 'member', userId: memberId });
  site = await new ProjectReviewService(serverDB, ownerId).createSite(projectId, {
    name: 'Marketing site',
    origins: [ORIGIN],
  });
  mocks.upload.mockReset();
  mocks.upload.mockImplementation(async (buffer: Buffer, mimeType: string, pathname: string) => {
    const [file] = await serverDB
      .insert(files)
      .values({
        fileType: mimeType,
        name: 'shot',
        size: buffer.length,
        url: pathname,
        userId: memberId,
      })
      .returning();
    return { fileId: file.id, key: pathname, url: pathname };
  });
});

afterEach(async () => {
  await cleanupTestUser(serverDB, memberId);
  await cleanupTestUser(serverDB, ownerId);
});

describe('review rounds on a site', () => {
  it('announces review rounds in the session', async () => {
    const response = await call(memberId, '/session');
    expect(await response.json()).toMatchObject({ features: ['review-rounds'] });
  });

  it('starts one draft per person and hands the existing one back on a second start', async () => {
    const first = await start(memberId);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      counts: { marks: 0 },
      mine: true,
      phase: 'draft',
      status: 'draft',
      user: { id: memberId },
    });

    const second = await start(memberId);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({
      error: { code: 'INVALID_STATE' },
      review: { id: first.body.id },
    });
  });

  it('keeps a draft private to its author', async () => {
    const { body: draft } = await start(memberId);

    expect((await call(ownerId, `/reviews/${draft.id}`)).status).toBe(404);
    const list = await (await call(ownerId, '/reviews?route=/notebook')).json();
    expect(list).toEqual({ draft: null, items: [] });

    const mine = await (await call(memberId, '/reviews?route=/settings')).json();
    expect(mine.draft).toMatchObject({ id: draft.id });
  });

  it('saves a mark with its geometry and screenshot', async () => {
    const { body: draft } = await start(memberId);
    const response = await call(memberId, `/reviews/${draft.id}/marks`, {
      json: { ...mark(), screenshot: { dataUrl: JPEG } },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    const saved = await response.json();
    expect(saved).toMatchObject({
      content: '卡片标题和正文之间太挤了',
      pageMeta: { title: 'Fieldnotes' },
      routeKey: '/notebook',
      url: `${ORIGIN}/notebook`,
      rectDocument: { height: 160, width: 384, x: 448, y: 1294 },
      regionRefs: [{ selector: 'article:nth-child(2)' }],
      screenshot: { url: expect.stringMatching(/^https:\/\/cdn\.example\.com\//) },
      seq: 1,
    });

    const review = await (await call(memberId, `/reviews/${draft.id}`)).json();
    expect(review.counts.marks).toBe(1);
    expect(review.marks.map((item: { id: string }) => item.id)).toEqual([saved.id]);
  });

  it('keeps the remark when the screenshot upload fails', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('storage down'));
    const { body: draft } = await start(memberId);
    const response = await call(memberId, `/reviews/${draft.id}/marks`, {
      json: { ...mark(), screenshot: { dataUrl: JPEG } },
      method: 'POST',
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ screenshot: null, seq: 1 });
  });

  it('refuses to write marks into somebody else’s draft', async () => {
    const { body: draft } = await start(memberId);
    const response = await call(ownerId, `/reviews/${draft.id}/marks`, {
      json: mark(),
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  it('edits and deletes marks of a draft', async () => {
    const { body: draft } = await start(memberId);
    const saved = await (
      await call(memberId, `/reviews/${draft.id}/marks`, { json: mark(), method: 'POST' })
    ).json();

    const patched = await call(memberId, `/reviews/${draft.id}/marks/${saved.id}`, {
      json: { content: '正文行高改成 1.9' },
      method: 'PATCH',
    });
    expect(await patched.json()).toMatchObject({ content: '正文行高改成 1.9', id: saved.id });

    const removed = await call(memberId, `/reviews/${draft.id}/marks/${saved.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect((await (await call(memberId, `/reviews/${draft.id}`)).json()).marks).toEqual([]);
  });

  it('discards a draft and frees the slot', async () => {
    const { body: draft } = await start(memberId);
    expect((await call(memberId, `/reviews/${draft.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(memberId, `/reviews/${draft.id}`)).status).toBe(404);
    expect((await start(memberId)).status).toBe(201);
  });

  it('rejects an invalid mark', async () => {
    const { body: draft } = await start(memberId);
    const response = await call(memberId, `/reviews/${draft.id}/marks`, {
      json: { ...mark(), content: '' },
      method: 'POST',
    });
    expect(response.status).toBe(400);
  });

  it('submits the round as the signed-in reviewer and returns it submitted', async () => {
    const { body: draft } = await start(memberId);
    mocks.submit.mockImplementationOnce(async (db: LobeChatDatabase, _actor, reviewId) => {
      const { AcceptanceReviewModel } = await import('@/database/models/acceptanceReview');
      await new AcceptanceReviewModel(db).markSubmitted(reviewId);
      return { operationId: 'op', taskId: 'task' };
    });

    const response = await call(memberId, `/reviews/${draft.id}/submit`, {
      json: { feedback: '整体偏挤' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.anything(),
      { userId: memberId, workspaceId: expect.any(String) },
      draft.id,
      { feedback: '整体偏挤' },
    );
    expect(await response.json()).toMatchObject({ id: draft.id, status: 'submitted' });
  });

  it('does not submit somebody else’s draft', async () => {
    const { body: draft } = await start(memberId);
    const response = await call(ownerId, `/reviews/${draft.id}/submit`, {
      json: {},
      method: 'POST',
    });
    expect(response.status).toBe(404);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('offers the project coordinator Agent for the submit sheet', async () => {
    const [agent] = await serverDB
      .insert(agents)
      .values({ title: 'Site Agent', userId: ownerId })
      .returning();
    const [project] = await serverDB.select().from(projects);
    await serverDB
      .update(projects)
      .set({ coordinatorAgentId: agent.id })
      .where(eq(projects.id, project.id));

    const response = await call(memberId, '/agents');
    expect(await response.json()).toEqual({
      items: [{ coordinator: true, id: agent.id, title: 'Site Agent' }],
    });
  });
});
