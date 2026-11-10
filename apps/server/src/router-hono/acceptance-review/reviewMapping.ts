import type {
  AcceptanceReviewDto,
  AcceptanceReviewMarkDto,
  AcceptanceReviewMarkResult,
  AcceptanceReviewPhase,
  AcceptanceReviewUserDto,
} from '@lobechat/types';
import { inArray } from 'drizzle-orm';

import type { AcceptanceReviewMarkRow, AcceptanceReviewRow } from '@/database/schemas';
import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { createEvidenceFileResolver } from '@/server/services/verify/evidenceFiles';

export interface ReviewProjection {
  counts?: { agentPassed: number; humanPassed: number };
  phase?: AcceptanceReviewPhase;
  reportUrl?: string | null;
  results?: Map<string, AcceptanceReviewMarkResult>;
  task?: { id: string; identifier: string | null } | null;
}

export const loadAuthors = async (db: LobeChatDatabase, ids: (string | null)[]) => {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const rows = unique.length
    ? await db
        .select({
          avatar: users.avatar,
          fullName: users.fullName,
          id: users.id,
          username: users.username,
        })
        .from(users)
        .where(inArray(users.id, unique))
    : [];
  return new Map<string, AcceptanceReviewUserDto>(
    rows.map((row) => [
      row.id,
      { avatar: row.avatar ?? undefined, id: row.id, name: row.fullName || row.username || '' },
    ]),
  );
};

export const screenshotResolver = (
  db: LobeChatDatabase,
  ownerUserId: string,
  workspaceId: string | null,
) => {
  const resolve = createEvidenceFileResolver(db, ownerUserId, workspaceId ?? undefined);
  return async (fileId: string | null) => {
    if (!fileId) return null;
    const meta = await resolve(fileId);
    return meta.fileUrl ? { url: meta.fileUrl } : null;
  };
};

export const toMarkDto = (
  row: AcceptanceReviewMarkRow,
  extra: {
    replyCount?: number;
    result?: AcceptanceReviewMarkResult;
    screenshot: { url: string } | null;
  },
): AcceptanceReviewMarkDto => ({
  clientId: row.clientId,
  content: row.content,
  context: row.context ?? undefined,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  kind: row.kind,
  pageUrl: row.pageUrl,
  rectDocument: row.rectDocument,
  rectViewport: row.rectViewport,
  regionRefs: row.regionRefs ?? undefined,
  regions: row.regions ?? undefined,
  replyCount: extra.replyCount ?? 0,
  result: extra.result,
  route: row.route,
  screenshot: extra.screenshot,
  scroll: row.scroll,
  seq: row.seq,
  sketch: row.sketch ?? undefined,
  targets: row.targets ?? undefined,
  viewport: row.viewport,
});

export const toReviewDto = (
  row: AcceptanceReviewRow,
  extra: {
    author?: AcceptanceReviewUserDto;
    markCount: number;
    marks?: AcceptanceReviewMarkDto[];
    projection?: ReviewProjection;
    viewerId: string;
  },
): AcceptanceReviewDto => ({
  agentId: row.agentId,
  author: extra.author ?? { id: row.authorUserId ?? '', name: '' },
  counts: {
    agentPassed: extra.projection?.counts?.agentPassed ?? 0,
    humanPassed: extra.projection?.counts?.humanPassed ?? 0,
    marks: extra.markCount,
  },
  createdAt: row.createdAt.toISOString(),
  deliveryAcceptanceId: row.deliveryAcceptanceId,
  id: row.id,
  marks: extra.marks,
  mine: row.authorUserId === extra.viewerId,
  pageTitle: row.pageTitle,
  pageUrl: row.pageUrl,
  phase: extra.projection?.phase ?? (row.status === 'draft' ? 'draft' : 'running'),
  reportUrl: extra.projection?.reportUrl ?? null,
  route: row.route,
  status: row.status,
  submittedAt: row.submittedAt?.toISOString() ?? null,
  summary: row.summary,
  task: extra.projection?.task ?? null,
  title: row.title,
});
