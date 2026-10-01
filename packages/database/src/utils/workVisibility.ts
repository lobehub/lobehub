import type { WorkAccessScope } from '@lobechat/types';
import { and, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Agent Share provenance is an access boundary, not Work ownership. */
export const notAgentShareWork = (metadata: AnyPgColumn) =>
  sql<boolean>`NOT COALESCE(${metadata} ? 'agentShare', false)`;

/**
 * Match a Work row against the caller's explicit access scope. Mirrors
 * `documentMatchesAccessScope`: the share scope pins all three ids so a
 * visitor only ever sees Works registered from their own share topic, and the
 * ordinary scope hides every share-stamped row from the creator's surfaces.
 */
export const workMatchesAccessScope = (metadata: AnyPgColumn, accessScope: WorkAccessScope) =>
  accessScope.type === 'agentShare'
    ? and(
        sql`${metadata} -> 'agentShare' ->> 'shareId' = ${accessScope.shareId}`,
        sql`${metadata} -> 'agentShare' ->> 'visitorUserId' = ${accessScope.visitorUserId}`,
        sql`${metadata} -> 'agentShare' ->> 'topicId' = ${accessScope.topicId}`,
      )
    : notAgentShareWork(metadata);
