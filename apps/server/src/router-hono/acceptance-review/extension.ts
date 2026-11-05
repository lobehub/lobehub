import { acceptanceReviewResource, siteReviewResource } from '@lobechat/const';
import { and, desc, eq, inArray, isNull, ne, notInArray, or, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/core/db-adaptor';
import {
  acceptances,
  projects,
  projectSites,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { signAcceptanceReviewToken, verifyAcceptanceExtensionJWT } from '@/libs/oidc-provider/jwt';
import { resolveReviewAccess } from '@/server/services/acceptanceReview/access';
import { latestPreviewOrigin } from '@/server/services/acceptanceReview/previewOrigin';
import { findSiteForOrigin } from '@/server/services/projectReview/sites';

import type { ReviewEnv } from './auth';
import { findProfile } from './data';
import { reviewError } from './errors';

type ExtensionContext = Context<ReviewEnv>;

const TARGET_LIMIT = 200;
const CANDIDATE_LIMIT = 500;
const SETTLED_STATUSES = ['accepted', 'closed', 'rejected', 'errored'] as const;

export const extensionAuth: MiddlewareHandler<ReviewEnv> = async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reviewError(c, 401, 'UNAUTHORIZED', 'Missing token');
  try {
    const { userId } = await verifyAcceptanceExtensionJWT(token);
    c.set('userId', userId);
  } catch {
    return reviewError(c, 401, 'UNAUTHORIZED', 'Invalid token');
  }
  c.set('db', await getServerDB());
  await next();
};

const memberWorkspaceIds = async (db: LobeChatDatabase, userId: string) => {
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaceMembers.deletedAt)));
  return rows.map((row) => row.workspaceId);
};

const ownedOrShared = (
  workspaceIds: string[],
  workspaceColumn: PgColumn,
  ownerColumn: PgColumn,
  userId: string,
): SQL => {
  const personal = and(isNull(workspaceColumn), eq(ownerColumn, userId))!;
  return workspaceIds.length ? or(inArray(workspaceColumn, workspaceIds), personal)! : personal;
};

const reviewableSites = async (db: LobeChatDatabase, userId: string, workspaceIds: string[]) => {
  const candidates = await db
    .select({
      acceptanceId: projectSites.acceptanceId,
      id: projectSites.id,
      name: projectSites.name,
      origins: projectSites.origins,
      project: {
        id: projects.id,
        name: projects.name,
        userId: projects.userId,
        workspaceId: projects.workspaceId,
      },
    })
    .from(projectSites)
    .innerJoin(projects, eq(projectSites.projectId, projects.id))
    .where(ownedOrShared(workspaceIds, projects.workspaceId, projects.userId, userId))
    .orderBy(desc(projectSites.updatedAt))
    .limit(CANDIDATE_LIMIT);

  const sites = [];
  for (const site of candidates) {
    if (sites.length >= TARGET_LIMIT) break;
    if (!site.acceptanceId) continue;
    const access = await resolveReviewAccess(db, userId, site.acceptanceId);
    if (!access?.can.comment) continue;
    sites.push({
      id: site.id,
      name: site.name,
      origins: site.origins,
      projectName: site.project.name,
      workspaceId: site.project.workspaceId,
    });
  }
  return sites;
};

const latestPreviewUrls = async (db: LobeChatDatabase, acceptanceIds: string[]) => {
  if (!acceptanceIds.length) return new Map<string, string>();
  const rounds = await db
    .selectDistinctOn([verifyRuns.acceptanceId], {
      acceptanceId: verifyRuns.acceptanceId,
      metadata: verifyRuns.metadata,
    })
    .from(verifyRuns)
    .where(
      and(
        inArray(verifyRuns.acceptanceId, acceptanceIds),
        sql`${verifyRuns.metadata}->>'previewUrl' IS NOT NULL`,
      ),
    )
    .orderBy(verifyRuns.acceptanceId, desc(verifyRuns.roundIndex));
  const urls = new Map<string, string>();
  for (const round of rounds) {
    const previewUrl = round.metadata?.previewUrl;
    if (round.acceptanceId && typeof previewUrl === 'string')
      urls.set(round.acceptanceId, previewUrl);
  }
  return urls;
};

const openPreviews = async (db: LobeChatDatabase, userId: string, workspaceIds: string[]) => {
  const candidates = await db
    .select({ id: acceptances.id, updatedAt: acceptances.updatedAt })
    .from(acceptances)
    .where(
      and(
        ownedOrShared(workspaceIds, acceptances.workspaceId, acceptances.userId, userId),
        notInArray(acceptances.status, [...SETTLED_STATUSES]),
        ne(acceptances.subjectType, 'site'),
      ),
    )
    .orderBy(desc(acceptances.updatedAt))
    .limit(CANDIDATE_LIMIT);

  const previewUrls = await latestPreviewUrls(
    db,
    candidates.map((candidate) => candidate.id),
  );
  const previews = [];
  for (const candidate of candidates) {
    if (previews.length >= TARGET_LIMIT) break;
    const previewUrl = previewUrls.get(candidate.id);
    if (!previewUrl) continue;
    const access = await resolveReviewAccess(db, userId, candidate.id);
    if (!access?.can.comment) continue;
    const { acceptance } = access;
    previews.push({
      id: acceptance.id,
      previewUrl,
      title: acceptance.metadata?.title || acceptance.requirement || undefined,
      updatedAt: candidate.updatedAt.toISOString(),
      workspaceId: acceptance.workspaceId,
    });
  }
  return previews;
};

export const getExtensionTargets = async (c: ExtensionContext) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const workspaceIds = await memberWorkspaceIds(db, userId);
  const [profile, sites, previews] = await Promise.all([
    findProfile(db, userId),
    reviewableSites(db, userId, workspaceIds),
    openPreviews(db, userId, workspaceIds),
  ]);

  const usedIds = [
    ...new Set(
      [...sites, ...previews]
        .map((target) => target.workspaceId)
        .filter((id): id is string => !!id),
    ),
  ];
  const names = usedIds.length
    ? await db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(inArray(workspaces.id, usedIds))
    : [];
  const nameById = new Map(names.map((row) => [row.id, row.name]));

  return c.json({
    acceptances: previews,
    sites,
    user: {
      avatar: profile?.avatar ?? undefined,
      name: profile?.fullName || profile?.username || '',
    },
    workspaces: usedIds
      .filter((id) => nameById.has(id))
      .map((id) => ({ id, name: nameById.get(id)! })),
  });
};

const isOrigin = (value: string) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const tokenRequestSchema = z.union([
  z.object({
    origin: z.string().refine(isOrigin, 'origin must be a bare origin'),
    siteId: z.string(),
  }),
  z.object({
    acceptanceId: z.string().uuid(),
    origin: z.string().refine(isOrigin, 'origin must be a bare origin'),
  }),
]);

export const mintExtensionToken = async (c: ExtensionContext) => {
  const parsed = tokenRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success)
    return reviewError(
      c,
      400,
      'INVALID_INPUT',
      'Expected { siteId, origin } or { acceptanceId, origin }',
    );
  const db = c.get('db');
  const userId = c.get('userId');

  if ('siteId' in parsed.data) {
    const { origin, siteId } = parsed.data;
    const site = await findSiteForOrigin(db, siteId, origin);
    if (!site?.acceptanceId) return reviewError(c, 404, 'SITE_GONE', 'Site not found');
    const access = await resolveReviewAccess(db, userId, site.acceptanceId);
    if (!access?.can.comment)
      return reviewError(c, 403, 'SITE_ACCESS_REVOKED', 'No access to this site');
    return c.json(
      await signAcceptanceReviewToken({ resource: siteReviewResource(site.id, origin), userId }),
    );
  }

  const { acceptanceId, origin } = parsed.data;
  const access = await resolveReviewAccess(db, userId, acceptanceId);
  if (!access) return reviewError(c, 404, 'NOT_FOUND', 'Acceptance not found');
  if (!access.can.comment) return reviewError(c, 403, 'FORBIDDEN', 'No access to this acceptance');
  if (origin !== (await latestPreviewOrigin(db, acceptanceId)))
    return reviewError(c, 403, 'WRONG_ORIGIN', 'Open this acceptance from its preview address');
  return c.json(
    await signAcceptanceReviewToken({
      resource: acceptanceReviewResource(access.acceptance.id, origin),
      userId,
    }),
  );
};
