import type { AgentShareFileProvenance } from '@lobechat/types';
import { LIBRARY_HIDDEN_FILE_SOURCES } from '@lobechat/types';
import { and, eq, exists, isNull, notExists, notInArray, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { files } from '../schemas';
import type { LobeChatDatabase } from '../type';

/** Agent-share provenance is an access boundary, not a file origin. */
export const notAgentShareFile = (metadata: AnyPgColumn) =>
  sql<boolean>`NOT COALESCE(${metadata} ? 'agentShare', false)`;

/** Files whose source belongs in ordinary library surfaces. */
export const libraryVisibleFileSource = (source: AnyPgColumn) =>
  or(isNull(source), notInArray(source, LIBRARY_HIDDEN_FILE_SOURCES));

/** Files that belong in ordinary library, knowledge, and search surfaces. */
export const libraryVisibleFile = (source: AnyPgColumn, metadata: AnyPgColumn) =>
  and(libraryVisibleFileSource(source), notAgentShareFile(metadata));

/** Exclude a document derived from an agent-share attachment. */
export const notAgentShareFileReference = (
  db: Pick<LobeChatDatabase, 'select'>,
  fileId: AnyPgColumn,
) =>
  notExists(
    db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), sql`COALESCE(${files.metadata} ? 'agentShare', false)`)),
  );

/** Resolve a file-derived document only inside its exact agent-share scope. */
export const agentShareFileReference = (
  db: Pick<LobeChatDatabase, 'select'>,
  fileId: AnyPgColumn,
  provenance: AgentShareFileProvenance,
) =>
  exists(
    db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          sql`${files.metadata} -> 'agentShare' ->> 'shareId' = ${provenance.shareId}`,
          sql`${files.metadata} -> 'agentShare' ->> 'visitorUserId' = ${provenance.visitorUserId}`,
        ),
      ),
  );
