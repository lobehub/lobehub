import type { FileAccessScope } from '@lobechat/types';
import { LIBRARY_HIDDEN_FILE_SOURCES, ordinaryFileAccessScope } from '@lobechat/types';
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

/** Match a file row against the caller's explicit access scope. */
export const fileMatchesAccessScope = (metadata: AnyPgColumn, accessScope: FileAccessScope) =>
  accessScope.type === 'agentShare'
    ? and(
        sql`${metadata} -> 'agentShare' ->> 'shareId' = ${accessScope.shareId}`,
        sql`${metadata} -> 'agentShare' ->> 'visitorUserId' = ${accessScope.visitorUserId}`,
      )
    : notAgentShareFile(metadata);

/** Match a file-derived document against the caller's explicit access scope. */
export const fileReferenceMatchesAccessScope = (
  db: Pick<LobeChatDatabase, 'select'>,
  fileId: AnyPgColumn,
  accessScope: FileAccessScope,
) =>
  accessScope.type === 'agentShare'
    ? exists(
        db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.id, fileId), fileMatchesAccessScope(files.metadata, accessScope))),
      )
    : notExists(
        db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.id, fileId), sql`COALESCE(${files.metadata} ? 'agentShare', false)`)),
      );

/** Exclude a document derived from an agent-share attachment. */
export const notAgentShareFileReference = (
  db: Pick<LobeChatDatabase, 'select'>,
  fileId: AnyPgColumn,
) => fileReferenceMatchesAccessScope(db, fileId, ordinaryFileAccessScope);
