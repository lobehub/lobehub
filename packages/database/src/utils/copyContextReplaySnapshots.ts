import { sql } from 'drizzle-orm';

import { messageContextSnapshots } from '../schemas';
import type { LobeChatDatabase } from '../type';
import type { IdPair } from './copyMessagesInDatabase';

/** Copy private input inside the same transaction as its authorized message graph. */
export const copyContextReplaySnapshots = async (params: {
  executor: Pick<LobeChatDatabase, 'execute'>;
  messageIdPairs: IdPair[];
  targetUserId: string;
  targetWorkspaceId?: string | null;
}) => {
  if (!params.messageIdPairs.length) return;
  await params.executor.execute(sql`
    with mapping as (
      select pair->>0 as source_id, pair->>1 as new_id
      from jsonb_array_elements(${JSON.stringify(params.messageIdPairs)}::jsonb) pair
    )
    insert into ${messageContextSnapshots} (message_id, user_id, workspace_id, snapshot)
    select mapping.new_id, ${params.targetUserId}, ${params.targetWorkspaceId ?? null},
      case when source.user_id = ${params.targetUserId} then
        (source.snapshot - 'parentSnapshotId' - 'historyStartId') || jsonb_strip_nulls(jsonb_build_object(
          'invocationId', mapping.new_id,
          'parentSnapshotId', (select new_id from mapping where source_id = source.snapshot->>'parentSnapshotId'),
          'historyStartId', (select new_id from mapping where source_id = source.snapshot->>'historyStartId'),
          'changes', coalesce((
            select jsonb_agg(change || jsonb_build_object('key',
              coalesce((select split_part(change->>'key', ':', 1) || ':' || new_id
                from mapping where source_id = substring(change->>'key' from position(':' in change->>'key') + 1)), change->>'key')) order by ordinal)
            from jsonb_array_elements(source.snapshot->'changes') with ordinality changes(change, ordinal)
          ), '[]'::jsonb)
        ))
      else jsonb_build_object(
        'version', 1, 'invocationId', mapping.new_id,
        'createdBy', source.user_id, 'sessionKey', source.snapshot->>'sessionKey',
        'sourceIds', source.snapshot->'sourceIds', 'changes', '[]'::jsonb,
        'invalidated', coalesce((source.snapshot->>'invalidated')::boolean, false)
          or exists(select 1 from jsonb_array_elements_text(source.snapshot->'sourceIds') id
            where id like 'memory:%' or id like 'memory-persona:%')
      ) end
    from ${messageContextSnapshots} source
    join mapping on mapping.source_id = source.message_id
  `);
};
