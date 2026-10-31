import type {
  ArtifactBoardChoice,
  ArtifactBoardManifest,
  WorkItem,
  WorkMetadata,
  WorkVersionItem,
} from '@lobechat/types';
import {
  artifactBoardManifestSchema,
  resolveArtifactBoardChoices,
  summarizeArtifactBoardChoices,
} from '@lobechat/types';
import { and, eq, sql } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { createNanoId } from '../../utils/idGenerator';
import { type WorkContext, workOwnership } from './context';
import { createDisplayWorkAdapter } from './displayWork';
import { type WorkVersionEventParams } from './internal';
import { registerWorkVersion } from './writes';

export const boardWorkAdapter = createDisplayWorkAdapter({ type: 'board' });

const boardResource = (ctx: WorkContext, boardId: string) =>
  and(workOwnership(ctx), eq(works.resourceType, 'board'), eq(works.resourceId, boardId));

export const createArtifactBoardId = () => `board_${createNanoId(12)()}`;

/** `R2 · B` for lists; the Work `status` column carries it. */
const choiceStatus = (manifest: ArtifactBoardManifest, choices: ArtifactBoardChoice[]) => {
  const summary = summarizeArtifactBoardChoices(manifest, choices);
  return summary ? `R${summary.round} · ${summary.label}` : null;
};

export interface RegisterBoardWorkParams extends Partial<WorkVersionEventParams> {
  boardId: string;
  manifest: ArtifactBoardManifest;
}

/**
 * Publish a manifest as the board's next version. The manifest JSON is the
 * version `content`; earlier choices stay on the Work and keep counting for
 * every round and option the new manifest still has.
 */
export const registerBoardWork = async (
  ctx: WorkContext,
  params: RegisterBoardWorkParams,
): Promise<WorkItem> => {
  const [existing] = await ctx.db
    .select({ id: works.id })
    .from(works)
    .where(boardResource(ctx, params.boardId))
    .limit(1);

  return registerWorkVersion(
    ctx,
    {
      resourceId: params.boardId,
      resourceType: 'board',
      type: 'board',
      userId: ctx.userId,
      visibility: 'private',
    },
    {
      agentId: params.agentId,
      changeType: existing ? 'updated' : 'created',
      messageId: params.messageId,
      threadId: params.threadId,
      toolIdentifier: params.toolIdentifier ?? 'lobe-artifact-board',
      toolName: params.toolName ?? 'publishBoard',
      topicId: params.topicId,
    },
    async (txCtx) => {
      const [current] = await txCtx.db
        .select({ metadata: works.metadata })
        .from(works)
        .where(boardResource(txCtx, params.boardId))
        .limit(1);
      const choices = resolveArtifactBoardChoices(
        params.manifest,
        (current?.metadata as WorkMetadata | null)?.board?.choices,
      );

      return {
        display: {
          content: JSON.stringify(params.manifest),
          description: params.manifest.description ?? null,
          identifier: params.boardId,
          status: choiceStatus(params.manifest, choices),
          title: params.manifest.title,
          url: null,
        },
        metadata: {
          board: {
            optionCount: params.manifest.rounds.reduce(
              (sum, round) => sum + round.options.length,
              0,
            ),
            roundCount: params.manifest.rounds.length,
          },
        },
      };
    },
  );
};

export interface BoardWorkWithVersion {
  version: WorkVersionItem;
  work: WorkItem & { metadata: WorkMetadata | null };
}

export const findBoardWork = async (
  ctx: WorkContext,
  boardId: string,
  version?: number,
): Promise<{ current: BoardWorkWithVersion; version: WorkVersionItem } | null> => {
  const [row] = await ctx.db
    .select({ version: workVersions, work: works })
    .from(works)
    .innerJoin(workVersions, eq(workVersions.id, works.currentVersionId))
    .where(boardResource(ctx, boardId))
    .limit(1);
  if (!row) return null;
  const current = { version: row.version, work: row.work as BoardWorkWithVersion['work'] };
  if (!version || version === row.version.version) return { current, version: row.version };

  const [older] = await ctx.db
    .select()
    .from(workVersions)
    .where(and(eq(workVersions.workId, row.work.id), eq(workVersions.version, version)))
    .limit(1);
  return older ? { current, version: older } : null;
};

/**
 * Record the option picked in one round. Written onto the Work (not a new
 * version) under a row lock, with the list status refreshed in the same
 * update. The round and option are checked against the manifest current
 * under that lock, so a republish racing the pick can never leave a choice of
 * an option the board no longer has.
 */
export const chooseBoardOption = async (
  ctx: WorkContext,
  params: { boardId: string; chosenBy: string | null; optionId: string; roundId: string },
): Promise<
  | { choices: ArtifactBoardChoice[]; manifest: ArtifactBoardManifest; status: 'chosen' }
  | { status: 'boardNotFound' | 'optionNotFound' }
> =>
  ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ content: workVersions.content, id: works.id, metadata: works.metadata })
      .from(works)
      .innerJoin(workVersions, eq(workVersions.id, works.currentVersionId))
      .where(boardResource({ ...ctx, db: tx as WorkContext['db'] }, params.boardId))
      .for('update', { of: works })
      .limit(1);
    if (!row) return { status: 'boardNotFound' };

    const manifest = artifactBoardManifestSchema.parse(JSON.parse(row.content ?? ''));
    const round = manifest.rounds.find((item) => item.id === params.roundId);
    if (!round?.options.some((option) => option.id === params.optionId))
      return { status: 'optionNotFound' };

    const stored = (row.metadata as WorkMetadata | null)?.board?.choices ?? {};
    const choices: Record<string, ArtifactBoardChoice> = {
      ...stored,
      [params.roundId]: {
        chosenAt: new Date().toISOString(),
        chosenBy: params.chosenBy,
        chosenOptionId: params.optionId,
        roundId: params.roundId,
      },
    };
    const valid = resolveArtifactBoardChoices(manifest, choices);

    await tx
      .update(works)
      .set({
        metadata: sql`coalesce(${works.metadata}, '{}'::jsonb) || jsonb_build_object('board', ${JSON.stringify({ choices })}::jsonb)`,
        status: choiceStatus(manifest, valid),
      })
      .where(eq(works.id, row.id));

    return { choices: valid, manifest, status: 'chosen' };
  });
