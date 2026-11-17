import { isNull, notInArray, or } from 'drizzle-orm';

import { DEDICATED_KNOWLEDGE_BASE_TYPES, knowledgeBases } from '../schemas';

/**
 * Keeps user-curated libraries and drops the ones dedicated to an agent or project.
 *
 * Use when:
 * - A query lists libraries for a user to browse, pick from, search or mount.
 *
 * Returns:
 * - A predicate on `knowledge_bases`; NULL `type` must be matched explicitly because
 *   `NOT IN` alone would discard every ordinary library.
 */
export const isUserKnowledgeBase = () =>
  or(
    isNull(knowledgeBases.type),
    notInArray(knowledgeBases.type, [...DEDICATED_KNOWLEDGE_BASE_TYPES]),
  );
