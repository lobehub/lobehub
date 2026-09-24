// @vitest-environment node
import { randomUUID } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import { acceptanceComments, acceptances, verifyRuns } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AcceptanceReviewJwtClaims } from '@/libs/trpc/utils/internalJwt';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

let serverDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: () => serverDB }));
vi.mock('@/database/server', () => ({ getServerDB: async () => serverDB }));
vi.mock('@/server/workflows/expertiseRejection', () => ({
  ExpertiseRejectionWorkflow: { trigger: vi.fn() },
}));
// Storage is not what these tests are about: record what would be stored.
const uploadFromBuffer = vi.fn(async () => ({ fileId: 'file_screenshot', key: 'k', url: 'u' }));
vi.mock('@/server/services/file', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    FileService: vi.fn().mockImplementation(function () {
      return { getFullFileUrl: async () => 'https://files/x', uploadFromBuffer };
    }),
  };
});
const claimsByToken = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/libs/trpc/utils/internalJwt', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    signAcceptanceReviewJWT: vi.fn(async (params: Record<string, unknown>) => {
      const token = `token-${claimsByToken.size + 1}`;
      claimsByToken.set(token, params);
      return token;
    }),
    validateAcceptanceReviewJWT: vi.fn(async (token: string) => claimsByToken.get(token) ?? null),
  };
});

const { authorizeReviewConnect, AcceptanceReviewSession, normalizeReviewOrigin } =
  await import('../index');
const { handleAcceptanceReviewPreflight, handleAcceptanceReviewRequest } = await import('../http');

const ORIGIN = 'https://product.example.com';
const PNG = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
const source = {
  kind: 'product-page' as const,
  selector: '#run-status',
  url: `${ORIGIN}/experiments`,
};

describe('normalizeReviewOrigin', () => {
  it('keeps an https origin and loopback http, refuses everything else', () => {
    expect(normalizeReviewOrigin('https://product.example.com/path?x=1')).toBe(ORIGIN);
    expect(normalizeReviewOrigin('http://localhost:5199')).toBe('http://localhost:5199');
    for (const bad of [
      'http://product.example.com',
      'javascript:alert(1)',
      'null',
      '',
      'https://u:p@x.com',
      'file:///etc',
    ])
      expect(normalizeReviewOrigin(bad)).toBeNull();
  });
});

describe('acceptance review', () => {
  let ownerId: string;
  let strangerId: string;
  let acceptanceId: string;

  const claims = (
    overrides: Partial<AcceptanceReviewJwtClaims> = {},
  ): AcceptanceReviewJwtClaims => ({
    acceptance_id: acceptanceId,
    aud: 'urn:lobehub:acceptance-review',
    capabilities: ['comment', 'reject'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    iss: 'urn:lobehub:internal',
    jti: randomUUID(),
    origin: ORIGIN,
    purpose: 'acceptance-review',
    sub: ownerId,
    ...overrides,
  });

  beforeEach(async () => {
    serverDB = await getTestDB();
    ownerId = await createTestUser(serverDB);
    strangerId = await createTestUser(serverDB);
    const [acceptance] = await serverDB
      .insert(acceptances)
      .values({
        requirement: '标签页标题随页面变化',
        status: 'delivered',
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'private',
      })
      .returning();
    acceptanceId = acceptance.id;
    await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId, roundIndex: 1, status: 'passed', userId: ownerId });
  });

  afterEach(async () => {
    uploadFromBuffer.mockClear();
    claimsByToken.clear();
    await cleanupTestUser(serverDB, strangerId);
    await cleanupTestUser(serverDB, ownerId);
  });

  describe('authorizeReviewConnect', () => {
    it('grants the owner comment and reject, bound to the approved origin', async () => {
      const result = await authorizeReviewConnect(serverDB, ownerId, {
        acceptanceId,
        origin: `${ORIGIN}/any/page`,
      });
      expect(result).toMatchObject({
        capabilities: ['comment', 'reject'],
        origin: ORIGIN,
        token: expect.any(String),
      });
      expect(claimsByToken.get(result.token)).toMatchObject({
        acceptanceId,
        origin: ORIGIN,
        userId: ownerId,
      });
    });

    it('hides a private acceptance from anyone else', async () => {
      await expect(
        authorizeReviewConnect(serverDB, strangerId, { acceptanceId, origin: ORIGIN }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('lets a visitor of a public acceptance comment but not reject', async () => {
      await serverDB
        .update(acceptances)
        .set({ visibility: 'public' })
        .where(eq(acceptances.id, acceptanceId));
      await expect(
        authorizeReviewConnect(serverDB, strangerId, { acceptanceId, origin: ORIGIN }),
      ).resolves.toMatchObject({ capabilities: ['comment'] });
    });

    it('refuses an origin nobody could have meant to approve', async () => {
      await expect(
        authorizeReviewConnect(serverDB, ownerId, {
          acceptanceId,
          origin: 'http://evil.example.com',
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('AcceptanceReviewSession', () => {
    it('stores a product-page remark with its screenshot as an acceptance comment', async () => {
      const session = new AcceptanceReviewSession(serverDB, claims());
      const created = await session.create({
        content: '失败原因看不出来',
        screenshot: PNG,
        source,
      });

      expect(uploadFromBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'image/png',
        expect.stringMatching(/^acceptance-review\//),
        expect.any(Function),
        expect.objectContaining({ source: 'acceptance' }),
      );
      const [row] = await serverDB
        .select()
        .from(acceptanceComments)
        .where(eq(acceptanceComments.id, created.id));
      expect(row).toMatchObject({
        anchorType: 'acceptance',
        attachments: [{ fileId: 'file_screenshot' }],
        authorUserId: ownerId,
        content: '失败原因看不出来',
        kind: 'comment',
        source,
      });
      await expect(session.listMine()).resolves.toEqual([
        expect.objectContaining({ id: created.id, source }),
      ]);
    });

    it("lists only the reviewer's own open product remarks, and removes only those", async () => {
      const session = new AcceptanceReviewSession(serverDB, claims());
      const first = await session.create({ content: 'a', source });
      const second = await session.create({ content: 'b', source });
      await serverDB
        .update(acceptanceComments)
        .set({ resolvedAt: new Date() })
        .where(eq(acceptanceComments.id, second.id));

      await expect(session.listMine()).resolves.toEqual([
        expect.objectContaining({ id: first.id }),
      ]);
      await session.remove(first.id);
      await expect(session.listMine()).resolves.toEqual([]);
      await expect(session.remove(second.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('sends the delivery back through the reject procedure', async () => {
      const result = await new AcceptanceReviewSession(serverDB, claims()).reject({
        comment: '见产品内标注',
      });
      expect(result).toMatchObject({
        repairDispatch: { dispatched: false, reason: 'no_origin' },
        status: 'rejected',
      });
    });

    it('holds a comment-only session to commenting', async () => {
      const session = new AcceptanceReviewSession(serverDB, claims({ capabilities: ['comment'] }));
      await expect(session.reject({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const [acceptance] = await serverDB
        .select()
        .from(acceptances)
        .where(eq(acceptances.id, acceptanceId));
      expect(acceptance.status).toBe('delivered');
    });
  });

  describe('HTTP', () => {
    const request = (
      path: string,
      init: RequestInit & { token?: string; origin?: string } = {},
    ) => {
      const headers = new Headers(init.headers);
      if (init.origin !== undefined) headers.set('origin', init.origin);
      if (init.token) headers.set('authorization', `Bearer ${init.token}`);
      return new Request(`https://app.lobehub.test/api/acceptance-review/${path}`, {
        ...init,
        headers,
      });
    };
    const tokenFor = (value: AcceptanceReviewJwtClaims) => {
      const token = `t-${randomUUID()}`;
      claimsByToken.set(token, value);
      return token;
    };

    it('answers a preflight for the asking origin without granting anything', async () => {
      const response = handleAcceptanceReviewPreflight(
        request('comments', { method: 'OPTIONS', origin: ORIGIN }),
      );
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('refuses a request without a valid session', async () => {
      const response = await handleAcceptanceReviewRequest(
        request('comments', { origin: ORIGIN }),
        ['comments'],
      );
      expect(response.status).toBe(401);
    });

    it('refuses a valid session used from another site', async () => {
      const token = tokenFor(claims());
      const response = await handleAcceptanceReviewRequest(
        request('comments', { origin: 'https://evil.example.com', token }),
        ['comments'],
      );
      expect(response.status).toBe(403);
    });

    it('creates and lists remarks for the approved site', async () => {
      const token = tokenFor(claims());
      const created = await handleAcceptanceReviewRequest(
        request('comments', {
          body: JSON.stringify({ content: '标题不对', source }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          origin: ORIGIN,
          token,
        }),
        ['comments'],
      );
      expect(created.status).toBe(201);
      expect(created.headers.get('access-control-allow-origin')).toBe(ORIGIN);

      const listed = await handleAcceptanceReviewRequest(
        request('comments', { origin: ORIGIN, token }),
        ['comments'],
      );
      await expect(listed.json()).resolves.toMatchObject({
        items: [expect.objectContaining({ content: '标题不对' })],
      });
    });

    it('validates the body before touching anything', async () => {
      const token = tokenFor(claims());
      const response = await handleAcceptanceReviewRequest(
        request('comments', {
          body: JSON.stringify({
            content: 'x',
            source: { kind: 'product-page', url: 'not a url' },
          }),
          method: 'POST',
          origin: ORIGIN,
          token,
        }),
        ['comments'],
      );
      expect(response.status).toBe(400);
    });
  });
});
