import { hashContent } from '@lobechat/context-engine/onDemand';
import {
  expertiseBindings,
  expertiseDomains,
  expertiseLessonRevisions,
  expertiseLessons,
} from '@lobechat/database/schemas';
import type { OnDemandContextCandidate } from '@lobechat/types';
import { and, eq, inArray, or } from 'drizzle-orm';

import type { LobeChatDatabase } from '@/database/type';

export interface RetrieveExpertiseCandidatesParams {
  agentId?: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

type LessonRow = {
  bindingAgentId: string | null;
  bindingUserId: string | null;
  bindingWorkspaceId: string | null;
  domainId: string;
  domainUserId: string;
  domainVisibility: string;
  domainWorkspaceId: string | null;
  lesson: typeof expertiseLessons.$inferSelect;
};

const lessonContent = (lesson: typeof expertiseLessons.$inferSelect): string =>
  [lesson.title, ...lesson.sections.map((section) => `${section.key}: ${section.body}`)]
    .filter(Boolean)
    .join('\n');

const contentHash = (lesson: typeof expertiseLessons.$inferSelect): string =>
  hashContent({ sections: lesson.sections, title: lesson.title });

/**
 * Resolve the approval state from the only durable signals available in the
 * existing expertise schema: lesson status plus revision continuity. A lesson
 * that points at a revision which no longer matches its content is downgraded
 * before reaching prompt assembly.
 */
export const resolveExpertiseApproval = (params: {
  latestRevision?: typeof expertiseLessonRevisions.$inferSelect;
  lesson: typeof expertiseLessons.$inferSelect;
}): OnDemandContextCandidate['approval'] => {
  const { latestRevision, lesson } = params;
  const currentHash = contentHash(lesson);

  if (lesson.status === 'rejected' || lesson.status === 'retired') {
    return { state: 'revoked' };
  }

  if (!latestRevision) {
    return { state: 'pending' };
  }

  if (latestRevision.revision !== lesson.currentRevision) {
    return { state: 'stale' };
  }

  const revisionHash = hashContent({ sections: latestRevision.sections, title: lesson.title });
  if (revisionHash !== currentHash) {
    return { approvedContentHash: revisionHash, state: 'hash_mismatch' };
  }

  // A revision is approval evidence only when the user made it. Agent/system
  // rewrites, and legacy rows without a revision, remain proposals.
  return latestRevision.changedBy === 'user'
    ? { approvedContentHash: currentHash, state: 'approved' }
    : { state: 'pending' };
};

export const toExpertiseCandidate = (params: {
  latestRevision?: typeof expertiseLessonRevisions.$inferSelect;
  row: LessonRow;
  scope: RetrieveExpertiseCandidatesParams;
}): OnDemandContextCandidate => {
  const { latestRevision, row, scope } = params;
  const content = lessonContent(row.lesson);
  const share =
    row.bindingAgentId === scope.agentId
      ? ('agent' as const)
      : row.bindingWorkspaceId && row.bindingWorkspaceId === scope.workspaceId
        ? ('workspace' as const)
        : row.bindingUserId === scope.userId
          ? ('personal' as const)
          : ('public' as const);
  const shareGate =
    row.domainUserId === scope.userId ||
    (!!scope.workspaceId && row.domainWorkspaceId === scope.workspaceId) ||
    row.domainVisibility === 'public'
      ? ('allowed' as const)
      : ('denied' as const);

  return Object.freeze({
    approval: resolveExpertiseApproval({ latestRevision, lesson: row.lesson }),
    authority: 'approved_experience',
    content,
    contentHash: contentHash(row.lesson),
    id: row.lesson.id,
    scope: {
      agentId: row.bindingAgentId ?? undefined,
      ownerUserId: row.bindingUserId ?? row.domainUserId,
      share,
      shareGate,
      workspaceId: row.bindingWorkspaceId ?? row.domainWorkspaceId ?? undefined,
    },
    source: { id: row.lesson.id, type: 'agent' as const },
    sourceVersion: `${row.domainId}@${row.lesson.currentRevision}`,
  });
};

/**
 * Load only expertise visible through a binding to this agent, workspace, or
 * user, and only when the owning domain is private to this scope or public.
 */
export const retrieveExpertiseCandidates = async (
  params: RetrieveExpertiseCandidatesParams,
): Promise<OnDemandContextCandidate[]> => {
  const bindingScope = [
    params.agentId ? eq(expertiseBindings.agentId, params.agentId) : undefined,
    params.workspaceId ? eq(expertiseBindings.boundWorkspaceId, params.workspaceId) : undefined,
    eq(expertiseBindings.boundUserId, params.userId),
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const domainScope = [
    eq(expertiseDomains.userId, params.userId),
    params.workspaceId ? eq(expertiseDomains.workspaceId, params.workspaceId) : undefined,
    eq(expertiseDomains.visibility, 'public'),
  ].filter((condition): condition is NonNullable<typeof condition> => Boolean(condition));
  const bindingMatch = bindingScope.length === 1 ? bindingScope[0] : or(...bindingScope);
  const domainMatch = domainScope.length === 1 ? domainScope[0] : or(...domainScope);

  const rows = (await params.db
    .select({
      bindingAgentId: expertiseBindings.agentId,
      bindingUserId: expertiseBindings.boundUserId,
      bindingWorkspaceId: expertiseBindings.boundWorkspaceId,
      domainId: expertiseDomains.id,
      domainUserId: expertiseDomains.userId,
      domainVisibility: expertiseDomains.visibility,
      domainWorkspaceId: expertiseDomains.workspaceId,
      lesson: expertiseLessons,
    })
    .from(expertiseBindings)
    .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseBindings.domainId))
    .innerJoin(expertiseLessons, eq(expertiseLessons.domainId, expertiseDomains.id))
    .where(
      and(
        eq(expertiseBindings.enabled, true),
        bindingMatch,
        domainMatch,
        inArray(expertiseLessons.status, ['active', 'rejected', 'retired']),
      ),
    )) as LessonRow[];

  const lessonIds = [...new Set(rows.map((row) => row.lesson.id))];
  const revisions =
    lessonIds.length === 0
      ? []
      : await params.db
          .select()
          .from(expertiseLessonRevisions)
          .where(inArray(expertiseLessonRevisions.lessonId, lessonIds));
  const latestRevisionByLesson = new Map<string, typeof expertiseLessonRevisions.$inferSelect>();
  for (const revision of revisions) {
    const current = latestRevisionByLesson.get(revision.lessonId);
    if (!current || revision.revision > current.revision) {
      latestRevisionByLesson.set(revision.lessonId, revision);
    }
  }

  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.lesson.id)) return false;
      seen.add(row.lesson.id);
      return true;
    })
    .map((row) =>
      toExpertiseCandidate({
        latestRevision: latestRevisionByLesson.get(row.lesson.id),
        row,
        scope: params,
      }),
    );
};
