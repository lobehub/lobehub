import { and, asc, desc, eq, or, type SQL, sql } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { escapeLike, ilikeContains } from '../../utils/like';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { FtsSearchTaskResult } from '../ftsSearch/types';

export interface TaskSearchOptions {
  limit?: number;
  query: string;
}

/** A bare task number (`827` or `#827`) — longer runs cannot be a valid `seq`. */
const SEQ_PATTERN = /^#?(\d{1,9})$/;

/** Characters of context kept on each side of a content match in the snippet. */
const SNIPPET_CONTEXT = 40;

/**
 * Markdown syntax that would crowd a one-line snippet: images, link targets,
 * line-leading heading/quote markers, bold markers and backticks. Literal
 * characters a query may contain (`retry_count`, `C#`) are kept.
 */
const toPlainText = (markdown: string) =>
  markdown
    .replaceAll(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replaceAll(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replaceAll(/^\s*(?:#{1,6}|>+)\s+/gm, '')
    .replaceAll(/\*\*|`+/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();

/**
 * The instruction text around the first match, so a result found only by its
 * body still shows why it matched. Falls back to the body's opening when the
 * match sits inside markdown that `toPlainText` stripped (an image URL).
 */
const buildSnippet = (instruction: string, needle: string): string | null => {
  const text = toPlainText(instruction);
  if (!text) return null;

  const haystack = text.toLowerCase();
  // A query that spans stripped syntax (`**bold** text`) is found once it is
  // normalized the same way as the body.
  const term = [needle, toPlainText(needle)]
    .map((candidate) => candidate.toLowerCase())
    .find((candidate) => candidate && haystack.includes(candidate));
  const index = term ? haystack.indexOf(term) : -1;
  const start = index < 0 ? 0 : Math.max(0, index - SNIPPET_CONTEXT);
  const end =
    index < 0 ? SNIPPET_CONTEXT * 2 : Math.min(text.length, index + term!.length + SNIPPET_CONTEXT);

  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
};

/**
 * Command-menu lookup for tasks by identifier, name, or content (description
 * and instruction).
 *
 * Tasks are not part of the full-text index, so this queries the `tasks` table
 * directly with the same visibility-aware ownership as `TaskModel.ownership()`:
 * public workspace tasks plus the caller's own private ones, never trashed rows.
 */
export class TaskSearchRepo {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  search = async ({ limit = 5, query }: TaskSearchOptions): Promise<FtsSearchTaskResult[]> => {
    const text = query.trim();
    if (!text || limit <= 0) return [];

    const seqMatch = text.match(SEQ_PATTERN);
    const identifierExact = sql`upper(${tasks.identifier}) = ${text.toUpperCase()}`;
    const exact = seqMatch
      ? (or(identifierExact, eq(tasks.seq, Number(seqMatch[1]))) as SQL)
      : identifierExact;
    const identifierPrefix = sql`${tasks.identifier} ILIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;
    const namePrefix = sql`${tasks.name} ILIKE ${`${escapeLike(text)}%`} ESCAPE '\\'`;
    const nameContains = ilikeContains(tasks.name, text);

    // Lower is better, matching FtsSearchBaseResult.relevance.
    const relevance = sql<number>`CASE
      WHEN ${exact} THEN 1
      WHEN ${identifierPrefix} THEN 2
      WHEN ${namePrefix} THEN 3
      WHEN ${nameContains} THEN 4
      ELSE 5
    END`;

    const rows = await this.db
      .select({
        agentId: tasks.assigneeAgentId,
        createdAt: tasks.createdAt,
        description: tasks.description,
        id: tasks.id,
        identifier: tasks.identifier,
        instruction: tasks.instruction,
        name: tasks.name,
        relevance,
        status: tasks.status,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        and(
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              isDeleted: tasks.isDeleted,
              userId: tasks.createdByUserId,
              visibility: tasks.visibility,
              workspaceId: tasks.workspaceId,
            },
          ),
          or(
            exact,
            identifierPrefix,
            nameContains,
            ilikeContains(tasks.description, text),
            ilikeContains(tasks.instruction, text),
          ),
        ),
      )
      .orderBy(asc(relevance), desc(tasks.updatedAt), desc(tasks.seq))
      .limit(limit);

    const needle = text.toLowerCase();

    return rows.map(({ description, instruction, name, relevance, ...row }) => ({
      ...row,
      // A body-only match shows the matched passage unless the description
      // already carries the term.
      description:
        Number(relevance) === 5 && instruction && !description?.toLowerCase().includes(needle)
          ? buildSnippet(instruction, text)
          : description,
      relevance: Number(relevance),
      title: name || row.identifier,
      type: 'task' as const,
    }));
  };
}
