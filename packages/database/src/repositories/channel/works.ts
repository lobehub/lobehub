import type { ChannelPublicWork, ExternalWorkResourceType } from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { channelJobs, channelMembers, works, workVersions } from '../../schemas';
import type { Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { notAgentShareWork } from '../../utils/workVisibility';

/** Cards per reply; one run rarely touches more external resources than this. */
const WORKS_PER_MESSAGE = 20;

const currentVersions = alias(workVersions, 'channel_current_work_versions');

const tokensTotal = sql`${workVersions.cumulativeUsage} #> '{usage,llm,tokens,total}'`;

/**
 * The external Works (GitHub, Linear, ...) each published reply's run touched, as public cards.
 *
 * Every member sees them, although the Works belong to the requester: a reply already shows what
 * it did, and these resources live outside LobeHub behind their own URL. Internal Works (documents,
 * canvases, files, tasks) stay with the requester. So the read is not scoped to the viewer; it is
 * scoped to `external` Works the requester registered during the job's own operation, and it
 * projects only the fields a card draws. No Work, version, topic or operation id leaves here.
 *
 * Cost and tokens are this run's: version snapshots are cumulative per operation, so the latest
 * one in the reply's operation holds them.
 */
export const externalWorksByMessage = async (
  tx: Transaction,
  channelId: string,
  messageIds: string[],
): Promise<Map<string, ChannelPublicWork[]>> => {
  const result = new Map<string, ChannelPublicWork[]>();
  if (!messageIds.length) return result;

  const rows = await tx
    .select({
      baseBranch: sql<string | null>`${currentVersions.metadata}->>'baseBranch'`,
      cost: sql<string | null>`max(${workVersions.cumulativeCost})`,
      description: works.description,
      headBranch: sql<string | null>`${currentVersions.metadata}->>'headBranch'`,
      identifier: works.identifier,
      lastActiveAt: sql<string>`max(${workVersions.createdAt})`,
      messageId: channelJobs.publishedMessageId,
      resourceType: works.resourceType,
      status: works.status,
      title: works.title,
      tokens: sql<string | null>`max(CASE WHEN jsonb_typeof(${tokensTotal}) = 'number'
        THEN (${tokensTotal})::text::numeric END)`,
      url: works.url,
    })
    .from(channelJobs)
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, channelJobs.channelId),
        eq(channelMembers.id, channelJobs.requesterMemberId),
      ),
    )
    .innerJoin(workVersions, eq(workVersions.rootOperationId, channelJobs.operationId))
    .innerJoin(
      works,
      and(
        eq(works.id, workVersions.workId),
        // The run is the requester's: a Work anyone else owns never rides this reply.
        eq(works.userId, channelMembers.userId),
      ),
    )
    .leftJoin(currentVersions, eq(currentVersions.id, works.currentVersionId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        inArray(channelJobs.publishedMessageId, messageIds),
        eq(works.type, 'external'),
        // A card without a link has nothing to open outside LobeHub.
        isNotNull(works.url),
        notTrashed(works.isDeleted),
        notAgentShareWork(works.metadata),
      ),
    )
    .groupBy(channelJobs.publishedMessageId, works.id, currentVersions.id)
    .orderBy(desc(sql`max(${workVersions.createdAt})`), desc(works.id));

  for (const row of rows) {
    const messageId = row.messageId!;
    const cards = result.get(messageId) ?? [];
    if (cards.length >= WORKS_PER_MESSAGE) continue;
    const tokens = row.tokens === null ? null : Number(row.tokens);
    cards.push({
      baseBranch: row.baseBranch,
      description: row.description,
      headBranch: row.headBranch,
      identifier: row.identifier,
      resourceType: row.resourceType as ExternalWorkResourceType,
      status: row.status,
      title: row.title,
      totalCost: row.cost === null ? null : Number(row.cost),
      totalTokens: tokens && Number.isFinite(tokens) && tokens > 0 ? tokens : null,
      url: row.url!,
    });
    result.set(messageId, cards);
  }
  return result;
};
