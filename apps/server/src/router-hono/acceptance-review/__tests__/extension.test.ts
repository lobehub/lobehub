// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  users,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { ProjectReviewService } from '@/server/services/projectReview';

let serverDB: LobeChatDatabase;

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  signAcceptanceReviewToken: async ({
    resource,
    userId,
  }: {
    resource: string;
    userId: string;
  }) => ({
    expiresAt: 2_000_000_000,
    token: `minted|${userId}|${resource}`,
  }),
  verifyAcceptanceExtensionJWT: async (token: string) => {
    const [kind, userId] = token.split('|');
    if (kind !== 'ext' || !userId) throw new Error('invalid');
    return { userId };
  },
  verifyAcceptanceReviewJWT: async () => {
    throw new Error('not used');
  },
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));

const { default: app } = await import('../index');

const BASE = 'http://localhost/api/acceptance-review/v1/extension';
const ORIGIN = 'https://fieldnotes.app';

describe('extension endpoints', () => {
  let ownerId: string;
  let guestId: string;
  let workspaceId: string;
  let site: { acceptanceId: string | null; id: string };
  let openId: string;
  let personalId: string;

  const get = (userId: string, path: string) =>
    app.request(`${BASE}${path}`, { headers: { authorization: `Bearer ext|${userId}` } });

  const post = (userId: string, body: unknown) =>
    app.request(`${BASE}/token`, {
      body: JSON.stringify(body),
      headers: { 'authorization': `Bearer ext|${userId}`, 'content-type': 'application/json' },
      method: 'POST',
    });

  const acceptance = async (
    values: Partial<typeof acceptances.$inferInsert>,
    previewUrl?: string,
  ) => {
    const [row] = await serverDB
      .insert(acceptances)
      .values({
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'private',
        ...values,
      })
      .returning();
    await serverDB.insert(verifyRuns).values({
      acceptanceId: row.id,
      metadata: previewUrl ? { previewUrl } : {},
      roundIndex: 1,
      userId: ownerId,
    });
    return row.id;
  };

  beforeEach(async () => {
    serverDB = await getTestDB();
    ownerId = await createTestUser(serverDB);
    guestId = await createTestUser(serverDB);
    await serverDB
      .update(users)
      .set({ avatar: 'https://cdn.example.com/innei.png', fullName: 'Innei' })
      .where(eq(users.id, ownerId));
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: ownerId })
      .returning();
    workspaceId = workspace.id;
    await serverDB.insert(workspaceMembers).values({ role: 'owner', userId: ownerId, workspaceId });
    const projectId = (
      await new ProjectModel(serverDB, ownerId, workspaceId).create({
        identifier: 'SITE',
        name: 'Fieldnotes 官网',
      })
    ).id;
    site = await new ProjectReviewService(serverDB, ownerId).createSite(projectId, {
      name: 'Marketing site',
      origins: [ORIGIN, 'https://*.fieldnotes.app'],
    });
    openId = await acceptance(
      { metadata: { title: 'Pricing page' }, status: 'delivered', workspaceId },
      'https://pr-12.preview.fieldnotes.app/',
    );
    await acceptance({ status: 'closed', workspaceId }, 'https://pr-9.preview.fieldnotes.app/');
    await acceptance({ status: 'verifying', workspaceId });
    personalId = await acceptance({ status: 'pending' }, 'http://localhost:3000/');
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, guestId);
    await cleanupTestUser(serverDB, ownerId);
  });

  describe('GET /targets', () => {
    it('lists the account, its workspaces, bound sites and open previews', async () => {
      const response = await get(ownerId, '/targets');
      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.user).toEqual({ avatar: 'https://cdn.example.com/innei.png', name: 'Innei' });
      expect(body.workspaces).toEqual([{ id: workspaceId, name: 'Fieldnotes' }]);
      expect(body.sites).toEqual([
        {
          id: site.id,
          name: 'Marketing site',
          origins: [ORIGIN, 'https://*.fieldnotes.app'],
          projectName: 'Fieldnotes 官网',
          workspaceId,
        },
      ]);
      expect(body.acceptances.map((a: { id: string }) => a.id).sort()).toEqual(
        [openId, personalId].sort(),
      );
      expect(body.acceptances.find((a: { id: string }) => a.id === openId)).toMatchObject({
        previewUrl: 'https://pr-12.preview.fieldnotes.app/',
        title: 'Pricing page',
        workspaceId,
      });
    });

    it('falls back to the most recent round that has a preview', async () => {
      const repairingId = await acceptance(
        { status: 'repairing', workspaceId },
        'https://pr-7.preview.fieldnotes.app/',
      );
      await serverDB
        .insert(verifyRuns)
        .values({ acceptanceId: repairingId, metadata: {}, roundIndex: 2, userId: ownerId });
      const body = await (await get(ownerId, '/targets')).json();
      expect(body.acceptances.find((a: { id: string }) => a.id === repairingId)).toMatchObject({
        previewUrl: 'https://pr-7.preview.fieldnotes.app/',
      });
    });

    it('shows an outsider nothing from the workspace', async () => {
      const response = await get(guestId, '/targets');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ acceptances: [], sites: [], workspaces: [] });
    });

    it('refuses a missing or non-extension token', async () => {
      expect((await app.request(`${BASE}/targets`)).status).toBe(401);
      const review = await app.request(`${BASE}/targets`, {
        headers: { authorization: `Bearer ${ownerId}|${site.id}|${ORIGIN}` },
      });
      expect(review.status).toBe(401);
    });
  });

  describe('POST /token', () => {
    it('mints a site token for a matching origin, including a wildcard one', async () => {
      const response = await post(ownerId, {
        origin: 'https://docs.fieldnotes.app',
        siteId: site.id,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        expiresAt: 2_000_000_000,
        token: `minted|${ownerId}|urn:lobehub:site:${site.id}:${encodeURIComponent('https://docs.fieldnotes.app')}`,
      });
    });

    it('mints an acceptance token for one the user can comment on', async () => {
      const origin = 'https://pr-12.preview.fieldnotes.app';
      const response = await post(ownerId, { acceptanceId: openId, origin });
      expect(response.status).toBe(200);
      expect((await response.json()).token).toBe(
        `minted|${ownerId}|urn:lobehub:acceptance:${openId}:${encodeURIComponent(origin)}`,
      );
    });

    it('refuses sites and acceptances the user cannot access', async () => {
      expect((await post(guestId, { origin: ORIGIN, siteId: site.id })).status).toBe(403);
      expect(
        (
          await post(guestId, {
            acceptanceId: openId,
            origin: 'https://pr-12.preview.fieldnotes.app',
          })
        ).status,
      ).toBe(404);
    });

    it('refuses an origin the site does not list, and malformed bodies', async () => {
      expect(
        (await post(ownerId, { origin: 'https://evil.example', siteId: site.id })).status,
      ).toBe(404);
      expect((await post(ownerId, { siteId: site.id })).status).toBe(400);
      expect((await post(ownerId, {})).status).toBe(400);
      expect((await post(ownerId, { acceptanceId: openId })).status).toBe(400);
    });

    it('refuses an acceptance token for an origin other than its preview', async () => {
      const response = await post(ownerId, {
        acceptanceId: openId,
        origin: 'https://evil.example',
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'WRONG_ORIGIN' } });
    });
  });
});
