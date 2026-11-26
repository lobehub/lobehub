import type { ContextReplaySnapshot } from '@lobechat/types';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { messageContextSnapshots, messages } from '../../schemas';
import { MessageScope } from './scope';

export const scrubContextReplaySnapshot = (
  snapshot: ContextReplaySnapshot,
  matches: (source: string) => boolean,
): ContextReplaySnapshot => {
  const { system, ...rest } = snapshot;
  const renderedDocument = snapshot.sourceIds.some(
    (source) => matches(source) && source.startsWith('document'),
  );
  return {
    ...rest,
    changes: snapshot.changes.filter((change) => !change.sourceIds.some(matches)),
    ...(system && !renderedDocument && { system }),
  };
};

/** Author-only storage; never joined into ordinary message queries. */
export class MessageContextReplays extends MessageScope {
  private visibleMessages = (ids: string[]) =>
    and(
      this.ownership(),
      or(
        inArray(messages.id, ids),
        sql`${messages.messageGroupId} in (
      with recursive replay_groups as (
        select id from message_groups where id in ${ids}
        union select child.id from message_groups child inner join replay_groups parent on child.parent_group_id = parent.id
      ) select id from replay_groups
    )`,
      ),
    );

  /** Dependency metadata may follow a shared transcript; private rendered input never does. */
  getContextReplayDependencies = async (
    ids: string[],
  ): Promise<Record<string, ContextReplaySnapshot>> => {
    if (!ids.length) return {};
    const rows = await this.db
      .select({
        id: messages.id,
        author: messageContextSnapshots.userId,
        sourceIds: sql<string[]>`${messageContextSnapshots.snapshot}->'sourceIds'`,
        sessionKey: sql<string>`${messageContextSnapshots.snapshot}->>'sessionKey'`,
      })
      .from(messageContextSnapshots)
      .innerJoin(messages, eq(messages.id, messageContextSnapshots.messageId))
      .where(this.visibleMessages(ids));
    const dependencies: Record<string, ContextReplaySnapshot> = Object.fromEntries(
      rows.map((row) => [
        row.id,
        {
          invocationId: row.id,
          createdBy: row.author,
          sourceIds: row.sourceIds,
          sessionKey: row.sessionKey,
          changes: [],
          version: 1 as const,
        },
      ]),
    );
    const groups = await this.db.execute(sql`
      with recursive replay_groups(root_id, id) as (
        select id, id from message_groups where id in ${ids}
        union select parent.root_id, child.id from message_groups child inner join replay_groups parent on child.parent_group_id = parent.id
      )
      select replay_groups.root_id as id, count(*)::int as total, count(message_context_snapshots.message_id)::int as covered,
        jsonb_agg(message_context_snapshots.snapshot->'sourceIds') as sources,
        case when count(distinct message_context_snapshots.user_id) = 1 then min(message_context_snapshots.user_id) end as author
      from replay_groups inner join messages on messages.message_group_id = replay_groups.id
      left join message_context_snapshots on messages.id = message_context_snapshots.message_id
      where messages.role = 'assistant' and ${this.ownership()}
      group by replay_groups.root_id
    `);
    for (const row of groups.rows as Array<{
      id: string;
      total: number;
      covered: number;
      sources: Array<string[] | null>;
      author?: string;
    }>) {
      dependencies[row.id] = {
        invocationId: row.id,
        sessionKey: 'compressed',
        version: 1,
        changes: [],
        createdBy: row.author,
        sourceIds: [...new Set(row.sources.flatMap((sources) => sources ?? []))],
        ...(row.total !== row.covered && { invalidated: true }),
      };
    }
    return dependencies;
  };

  getContextReplays = async (ids: string[]): Promise<Record<string, ContextReplaySnapshot>> => {
    if (!ids.length) return {};
    const rows = await this.db
      .select({ id: messages.id, snapshot: messageContextSnapshots.snapshot })
      .from(messageContextSnapshots)
      .innerJoin(messages, eq(messages.id, messageContextSnapshots.messageId))
      .where(and(this.visibleMessages(ids), eq(messageContextSnapshots.userId, this.userId)));
    return Object.fromEntries(rows.map((row) => [row.id, row.snapshot]));
  };

  // Source ids stay so later access checks still see the dependency; only rendered text goes.
  scrubContextReplaySources = async ({
    ids = [],
    prefixes = [],
  }: {
    ids?: string[];
    prefixes?: string[];
  }) => {
    if (!ids.length && !prefixes.length) return 0;
    const idSet = new Set(ids);
    const matches = (source: string) =>
      idSet.has(source) || prefixes.some((prefix) => source.startsWith(prefix));
    const conditions = [
      ...(ids.length ? [sql`source.value in ${ids}`] : []),
      ...prefixes.map((prefix) => sql`starts_with(source.value, ${prefix})`),
    ];
    const scope = this.workspaceId
      ? or(
          eq(messageContextSnapshots.userId, this.userId),
          eq(messageContextSnapshots.workspaceId, this.workspaceId),
        )
      : eq(messageContextSnapshots.userId, this.userId);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: messageContextSnapshots.messageId,
          snapshot: messageContextSnapshots.snapshot,
        })
        .from(messageContextSnapshots)
        .where(
          and(
            scope,
            sql`exists (select 1 from jsonb_array_elements_text(${messageContextSnapshots.snapshot} -> 'sourceIds') as source(value) where ${sql.join(conditions, sql` or `)})`,
          ),
        )
        .for('update');
      for (const row of rows)
        await tx
          .update(messageContextSnapshots)
          .set({ snapshot: scrubContextReplaySnapshot(row.snapshot, matches) })
          .where(eq(messageContextSnapshots.messageId, row.id));
      return rows.length;
    });
  };

  commitContextReplay = async (
    id: string,
    snapshot: ContextReplaySnapshot,
  ): Promise<ContextReplaySnapshot> => {
    if (snapshot.invocationId !== id)
      throw new Error('Context snapshot belongs to another invocation');
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            this.ownership(),
            eq(messages.id, id),
            eq(messages.userId, this.userId),
            eq(messages.role, 'assistant'),
          ),
        )
        .for('update');
      if (!message) throw new Error('Context snapshot message is unavailable');
      const [existing] = await tx
        .select()
        .from(messageContextSnapshots)
        .where(eq(messageContextSnapshots.messageId, id));
      if (existing) return existing.snapshot;
      const committed = { ...snapshot, createdBy: this.userId };
      await tx.insert(messageContextSnapshots).values({
        messageId: id,
        userId: this.userId,
        workspaceId: this.workspaceId,
        snapshot: committed,
      });
      return committed;
    });
  };
}
