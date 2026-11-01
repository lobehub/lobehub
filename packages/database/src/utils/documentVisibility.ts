import type { DocumentAccessScope } from '@lobechat/types';
import { and, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/** Agent Share provenance is an access boundary, not document ownership. */
export const notAgentShareDocument = (metadata: AnyPgColumn) =>
  sql<boolean>`NOT COALESCE(${metadata} ? 'agentShare', false)`;

/** Match a generated document against the caller's explicit access scope. */
export const documentMatchesAccessScope = (
  metadata: AnyPgColumn,
  accessScope: DocumentAccessScope,
) =>
  accessScope.type === 'agentShare'
    ? and(
        sql`${metadata} -> 'agentShare' ->> 'shareId' = ${accessScope.shareId}`,
        sql`${metadata} -> 'agentShare' ->> 'visitorUserId' = ${accessScope.visitorUserId}`,
        sql`${metadata} -> 'agentShare' ->> 'topicId' = ${accessScope.topicId}`,
      )
    : notAgentShareDocument(metadata);
