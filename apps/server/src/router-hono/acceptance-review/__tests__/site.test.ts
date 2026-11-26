// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { projectSites, users, workspaceMembers, workspaces } from '@lobechat/database/schemas';
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

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/libs/oidc-provider/jwt', () => ({
  verifyAcceptanceReviewJWT: async (token: string) => {
    const [userId, siteId, origin, clientId = 'lobehub-acceptance'] = token.split('|');
    if (!origin) throw new Error('invalid');
    return { clientId, expiresAt: 2_000_000_000, site: { origin, siteId }, userId };
  },
}));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));
vi.mock('@/envs/app', async (importOriginal) => {
  const original = await importOriginal<{ appEnv: Record<string, unknown> }>();
  return { ...original, appEnv: { ...original.appEnv, APP_URL: 'https://app.fieldnotes.app/' } };
});

const { default: app } = await import('../index');

const BASE = 'http://localhost/api/acceptance-review/v1';
const ORIGIN = 'https://fieldnotes.app';
const APP_ORIGIN = 'https://app.fieldnotes.app';

describe('site review tokens', () => {
  let ownerId: string;
  let guestId: string;
  let projectId: string;
  let workspaceId: string;
  let site: { acceptanceId: string | null; id: string };

  const call = (userId: string, path: string, origin = ORIGIN, tokenOrigin = ORIGIN) =>
    app.request(`${BASE}${path}`, {
      headers: {
        authorization: `Bearer ${userId}|${site.id}|${tokenOrigin}`,
        origin,
      },
    });

  beforeEach(async () => {
    serverDB = await getTestDB();
    ownerId = await createTestUser(serverDB);
    guestId = await createTestUser(serverDB);
    await serverDB.update(users).set({ fullName: 'Innei' }).where(eq(users.id, ownerId));
    await serverDB
      .update(users)
      .set({ email: 'alex@studio-north.co' })
      .where(eq(users.id, guestId));
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: ownerId })
      .returning();
    workspaceId = workspace.id;
    await serverDB.insert(workspaceMembers).values({ workspaceId, userId: ownerId, role: 'owner' });
    projectId = (
      await new ProjectModel(serverDB, ownerId, workspaceId).create({
        identifier: 'SITE',
        name: 'Fieldnotes 官网',
      })
    ).id;
    site = await new ProjectReviewService(serverDB, ownerId).createSite(projectId, {
      name: 'Marketing site',
      origins: [ORIGIN],
    });
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, guestId);
    await cleanupTestUser(serverDB, ownerId);
  });

  it('opens the standing review with project, site and role, and never offers a decision', async () => {
    const response = await call(ownerId, '/session');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      acceptance: { id: site.acceptanceId, title: 'Site review · Marketing site' },
      can: { comment: true, decide: false, moderate: true, reject: false },
      project: { id: projectId, name: 'Fieldnotes 官网' },
      role: 'admin',
      site: { id: site.id, name: 'Marketing site' },
    });
  });

  it('rejects a request from another origin than the one the token was issued for', async () => {
    const response = await call(ownerId, '/session', 'https://fieldnotes-mirror.net');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  describe('from the browser extension', () => {
    const EXTENSION_ORIGIN = 'chrome-extension://fjgpjfdackkmgdldjiebkhkdacbibhnb';
    const extensionCall = (userId: string, clientId: string, origin?: string) =>
      app.request(`${BASE}/session`, {
        headers: {
          authorization: `Bearer ${userId}|${site.id}|${ORIGIN}|${clientId}`,
          ...(origin ? { origin } : {}),
        },
      });

    it('checks the Origin of a site token the extension handed to the page', async () => {
      const onSite = await extensionCall(ownerId, 'lobehub-acceptance-extension', ORIGIN);
      expect(onSite.status).toBe(200);
      expect(await onSite.json()).toMatchObject({ site: { id: site.id } });
      const elsewhere = await extensionCall(
        ownerId,
        'lobehub-acceptance-extension',
        EXTENSION_ORIGIN,
      );
      expect(elsewhere.status).toBe(403);
      expect(await elsewhere.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect((await extensionCall(ownerId, 'lobehub-acceptance-extension')).status).toBe(403);
    });

    it('still checks access for an extension-minted token', async () => {
      const response = await extensionCall(guestId, 'lobehub-acceptance-extension', ORIGIN);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: 'SITE_ACCESS_REVOKED' } });
    });

    it('keeps the Origin check for tokens the page signed in for', async () => {
      expect((await extensionCall(ownerId, 'lobehub-acceptance', EXTENSION_ORIGIN)).status).toBe(
        403,
      );
    });
  });

  describe('on the LobeHub app origin itself', () => {
    const sameOriginCall = (headers: Record<string, string>) =>
      app.request(`${BASE}/session`, {
        headers: { authorization: `Bearer ${ownerId}|${site.id}|${APP_ORIGIN}`, ...headers },
      });

    beforeEach(async () => {
      site = await new ProjectReviewService(serverDB, ownerId).createSite(projectId, {
        name: 'LobeHub app',
        origins: [APP_ORIGIN, ORIGIN],
      });
    });

    it('accepts a same-origin request, which browsers send without an Origin header', async () => {
      const response = await sameOriginCall({ 'sec-fetch-site': 'same-origin' });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ site: { id: site.id } });
    });

    it('still rejects a request that carries neither Origin nor a same-origin fetch marker', async () => {
      expect((await sameOriginCall({})).status).toBe(403);
      expect((await sameOriginCall({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    });

    it('rejects a same-origin request when the token was issued for another origin', async () => {
      const response = await app.request(`${BASE}/session`, {
        headers: {
          'authorization': `Bearer ${ownerId}|${site.id}|${ORIGIN}`,
          'sec-fetch-site': 'same-origin',
        },
      });
      expect(response.status).toBe(403);
    });
  });

  describe('install beacon', () => {
    const beacon = (siteId: string, headers: Record<string, string> = {}) =>
      app.request(`${BASE}/sites/${siteId}/beacon`, {
        body: '',
        headers: { 'content-type': 'text/plain', ...headers },
        method: 'POST',
      });
    const lastSeen = async () =>
      (await serverDB.select().from(projectSites).where(eq(projectSites.id, site.id)))[0]
        .lastSeenAt;

    it('records a load from a registered origin without any sign-in', async () => {
      const response = await beacon(site.id, { origin: ORIGIN });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(await lastSeen()).toBeInstanceOf(Date);
    });

    it('ignores a load from an origin the site does not list', async () => {
      const response = await beacon(site.id, { origin: 'https://fieldnotes-mirror.net' });
      expect(response.status).toBe(204);
      expect(await lastSeen()).toBeNull();
    });

    it('ignores a request without an Origin header', async () => {
      expect((await beacon(site.id)).status).toBe(204);
      expect(await lastSeen()).toBeNull();
    });

    it('answers the same way for a site that does not exist', async () => {
      const response = await beacon('psite_missing', { origin: ORIGIN });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    });
  });

  it('reads a site that no longer lists the origin as gone', async () => {
    await serverDB
      .update(projectSites)
      .set({ origins: ['https://other.fieldnotes.app'] })
      .where(eq(projectSites.id, site.id));
    const response = await call(ownerId, '/session');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'SITE_GONE' } });
  });

  it('applies role overrides on the next request and clearing them restores workspace access', async () => {
    await serverDB
      .insert(workspaceMembers)
      .values({ workspaceId, userId: guestId, role: 'member' });
    expect((await call(guestId, '/session')).status).toBe(200);
    const members = new ProjectMemberModel(serverDB);
    await members.add({ projectId, userId: guestId, role: 'viewer' });
    const response = await call(guestId, '/session');
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'SITE_ACCESS_REVOKED' } });
    await members.clearRole(workspaceId, projectId, guestId);
    expect((await call(guestId, '/session')).status).toBe(200);
  });

  it('names a site publicly for the connect pill and hides unknown site IDs', async () => {
    const response = await app.request(`${BASE}/sites/${site.id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: 'Marketing site',
      project: { name: 'Fieldnotes 官网' },
    });
    expect((await app.request(`${BASE}/sites/psite_000000000000`)).status).toBe(404);
  });
});
