import { isWorkspaceReadableVisibility } from '@lobechat/const/verify';
import type { LobeChatDatabase } from '@lobechat/database';
import { asc, eq } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { WorkspaceMemberModel } from '@/database/models/workspaceMember';
import {
  verifyCheckResults,
  verifyEvidence,
  verifyReports,
  verifyRuns,
} from '@/database/schemas/verify';
import { isUuid } from '@/database/utils/uuid';
import { publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createEvidenceFileResolver, resolveEvidenceFiles } from '@/server/services/verify';

const publicVerifyReportProcedure = publicProcedure.use(serverDatabase);

// A run's check results and their evidence are runtime-sized; cap the per-row reads.
const EVIDENCE_LOAD_CONCURRENCY = 5;

const verifyRunIdInputSchema = z.object({ verifyRunId: z.string() });

/**
 * Load a run through the read capability its id grants: a `public` run is
 * readable by anyone holding the id; a `private` one only by its owner and (for
 * workspace scope) members of that workspace; an `owner` one by its owner alone. Missing, malformed and denied all
 * read as `null` — existence must not leak.
 */
const findReadableVerifyRun = async (
  ctx: { serverDB: LobeChatDatabase; userId?: string | null },
  verifyRunId: string,
) => {
  // Public entry fed by shared links: a chat autolinker can glue trailing
  // CJK punctuation onto the URL, so a malformed uuid must read as absent
  // instead of aborting in Postgres (22P02 → 500).
  if (!isUuid(verifyRunId)) return null;
  const run = await ctx.serverDB.query.verifyRuns.findFirst({
    where: eq(verifyRuns.id, verifyRunId),
  });
  if (!run) return null;

  const isOwner = Boolean(ctx.userId) && ctx.userId === run.userId;
  let canRead = isOwner || run.visibility === 'public';
  if (!canRead && ctx.userId && run.workspaceId && isWorkspaceReadableVisibility(run.visibility)) {
    const member = await new WorkspaceMemberModel(ctx.serverDB, ctx.userId).getMember(
      run.workspaceId,
      ctx.userId,
    );
    canRead = Boolean(member);
  }

  return canRead ? { isOwner, run } : null;
};

/** Public, id-addressed reads of one verify run, merged into `verifyRouter`. */
export const verifyRunReportProcedures = {
  /**
   * One-shot payload for the report viewer (chat portal, acceptance round
   * ledger): the session, its report, and every check result with its
   * evidence — addressed purely by verifyRunId (no operation / chat context
   * required).
   *
   * Public like the acceptance page — see {@link findReadableVerifyRun}.
   * `isOwner` additionally gates what only the author may see — today the
   * origin conversation, which is redacted for everyone else.
   */
  getReportBundle: publicVerifyReportProcedure
    .input(verifyRunIdInputSchema)
    .query(async ({ ctx, input }) => {
      const readable = await findReadableVerifyRun(ctx, input.verifyRunId);
      if (!readable) return null;

      const { isOwner, run: found } = readable;
      // `origin` points at the author's private topic/agent — never hand it to a
      // visitor holding nothing but the shared link.
      const { origin: _origin, ...publicMetadata } = found.metadata ?? {};
      const run =
        isOwner || !found.metadata?.origin ? found : { ...found, metadata: publicMetadata };
      const [report, results] = await Promise.all([
        ctx.serverDB.query.verifyReports.findFirst({
          where: eq(verifyReports.verifyRunId, input.verifyRunId),
        }),
        ctx.serverDB
          .select()
          .from(verifyCheckResults)
          .where(eq(verifyCheckResults.verifyRunId, input.verifyRunId))
          .orderBy(asc(verifyCheckResults.checkItemIndex)),
      ]);

      // Resolve display metadata for each file-backed evidence artifact.
      const resolveFileMeta = createEvidenceFileResolver(
        ctx.serverDB,
        run.userId,
        run.workspaceId ?? undefined,
      );

      const resultsWithEvidence = await pMap(
        results,
        async (r) => {
          const evidence = await ctx.serverDB
            .select()
            .from(verifyEvidence)
            .where(eq(verifyEvidence.checkResultId, r.id))
            .orderBy(asc(verifyEvidence.createdAt));
          return {
            ...r,
            evidence: await pMap(evidence, (e) => resolveEvidenceFiles(resolveFileMeta, e), {
              concurrency: EVIDENCE_LOAD_CONCURRENCY,
            }),
          };
        },
        { concurrency: EVIDENCE_LOAD_CONCURRENCY },
      );
      return { isOwner, report: report ?? null, results: resultsWithEvidence, run };
    }),

  /**
   * Where an old `/verify/:runId` link now lands: the acceptance and round the
   * run belongs to. Same access rule as `getReportBundle` — and both fields
   * were already part of the bundle's `run` — so the redirect reveals nothing
   * the run id did not. A run outside any acceptance reads as `null`, exactly
   * like a missing or denied one.
   */
  getRunAcceptanceRound: publicVerifyReportProcedure
    .input(verifyRunIdInputSchema)
    .query(async ({ ctx, input }) => {
      const readable = await findReadableVerifyRun(ctx, input.verifyRunId);
      const acceptanceId = readable?.run.acceptanceId;
      if (!acceptanceId) return null;

      return { acceptanceId, roundIndex: readable.run.roundIndex ?? null };
    }),
};
