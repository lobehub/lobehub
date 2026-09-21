import type { SQLWrapper } from 'drizzle-orm';
import { and, ne, or, sql } from 'drizzle-orm';

import { messages } from '../schemas';
import { SEARCHABLE_TEXT_SQL_PATTERN } from './searchableText';

export const searchableMessageText = (content: SQLWrapper, summary: SQLWrapper) =>
  or(
    sql`coalesce(${content} ~ ${sql.raw(SEARCHABLE_TEXT_SQL_PATTERN)}, false)`,
    sql`coalesce(${summary} ~ ${sql.raw(SEARCHABLE_TEXT_SQL_PATTERN)}, false)`,
  )!;

/** Shared source eligibility for message search, candidates, and ES projection. */
export const searchableMessage = () =>
  and(ne(messages.role, 'tool'), searchableMessageText(messages.content, messages.summary))!;
