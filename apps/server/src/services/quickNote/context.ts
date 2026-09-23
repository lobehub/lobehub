/** One bounded candidate supplied to a Quick Note Agent. */
export interface QuickNoteContextCandidate {
  /** Candidate evidence, when the source has a useful text projection. */
  content?: string | null;
  /** Stable Document or Topic identifier. */
  id: string;
  /** Candidate display title. */
  title?: string | null;
  /** Canonical product resource family. */
  type: 'document' | 'topic';
}

/** Maximum distinct lexical hints accepted from one Analyze result. */
const QUICK_NOTE_CONTEXT_QUERY_LIMIT = 8;

/** Maximum literal terms used after bounded phrase expansion. */
const QUICK_NOTE_CONTEXT_SEARCH_TERM_LIMIT = 16;

/**
 * Normalizes Agent-authored context lookup hints into safe, bounded lexical terms.
 *
 * Before:
 * - `["  voice  ", "audio%", "voice", "_"]`
 *
 * After:
 * - `["voice", "audio"]`
 */
export const normalizeQuickNoteContextQueries = (queries: string[]): string[] =>
  queries
    .map((query) => query.replaceAll(/[%_]/g, ' ').replaceAll(/\s+/g, ' ').trim().slice(0, 48))
    .filter((query) => query.length >= 2)
    .filter((query, index, items) => items.indexOf(query) === index)
    .slice(0, QUICK_NOTE_CONTEXT_QUERY_LIMIT);

/**
 * Expands short Agent-authored phrases into literal database lookup terms.
 *
 * Before:
 * - `["streaming audio", "speech"]`
 *
 * After:
 * - `["streaming audio", "streaming", "audio", "speech"]`
 */
export const expandQuickNoteContextSearchTerms = (queries: string[]): string[] =>
  normalizeQuickNoteContextQueries(queries)
    .flatMap((query) => {
      const delimitedTerms = query.split(/[\s/_-]+/).filter((term) => term.length >= 2);
      // CJK hints commonly arrive as compact compounds without separators.
      // Non-overlapping pairs preserve useful literal nouns such as `音频`
      // without introducing a tokenizer or semantic retrieval dependency.
      const cjkTerms = /^\p{Script=Han}{4,}$/u.test(query) ? (query.match(/.{2}/gu) ?? []) : [];

      return [query, ...delimitedTerms, ...cjkTerms];
    })
    .filter((query, index, items) => items.indexOf(query) === index)
    .slice(0, QUICK_NOTE_CONTEXT_SEARCH_TERM_LIMIT);

/**
 * Ranks lightweight product candidates by how many Agent-authored lookup hints they contain.
 *
 * Use when:
 * - A Quick Note Analyze result has supplied a handful of lexical context hints.
 * - Database rows need deterministic ordering before they become Resource Links.
 *
 * Expects:
 * - Candidate content is already authorization-scoped by the caller.
 * - Queries have passed through {@link normalizeQuickNoteContextQueries}.
 *
 * Returns:
 * - Unique candidates ordered by match count, then by their input order.
 */
export const rankQuickNoteContextCandidates = (
  candidates: QuickNoteContextCandidate[],
  queries: string[],
  limit: number,
): QuickNoteContextCandidate[] => {
  const normalizedQueries = queries.map((query) => query.toLocaleLowerCase());
  const uniqueCandidates = candidates.filter(
    (candidate, index, items) =>
      items.findIndex((item) => item.id === candidate.id && item.type === candidate.type) === index,
  );

  return uniqueCandidates
    .map((candidate, index) => {
      const haystack = [candidate.title, candidate.content]
        .filter((value): value is string => Boolean(value))
        .join('\n')
        .toLocaleLowerCase();
      const score = normalizedQueries.filter((query) => haystack.includes(query)).length;

      return { candidate, index, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => candidate);
};

/** A recent Topic selected by the scoped database query. */
export interface QuickNoteRecentTopic {
  /** Topic-authored content that can bootstrap interpretation. */
  content?: string | null;
  /** Topic description that can bootstrap interpretation. */
  description?: string | null;
  /** Optional user-enabled history summary. */
  historySummary?: string | null;
  /** Stable Topic identifier. */
  id: string;
  /** Current Topic title. */
  title?: string | null;
}

/** A recent Message snippet selected for one recent Topic. */
export interface QuickNoteRecentMessage {
  /** Plain Message content. */
  content?: string | null;
  /** Parent Topic identifier. */
  topicId?: string | null;
}

/** Maximum Message snippets included for one Topic candidate. */
const QUICK_NOTE_MESSAGE_SNIPPET_LIMIT = 2;

/**
 * Builds bounded Topic context without requiring a search backend or history summaries.
 *
 * Use when:
 * - Quick Note Analyze needs a small recent-context bootstrap.
 * - Full-text search is unavailable or intentionally outside the lightweight V1 path.
 *
 * Expects:
 * - Topics and Messages are already owner/workspace scoped.
 * - Both inputs are ordered newest first by the caller.
 *
 * Returns:
 * - Topic candidates in the supplied recent order, with at most two Message snippets each.
 */
export const buildQuickNoteTopicCandidates = (
  topics: QuickNoteRecentTopic[],
  messages: QuickNoteRecentMessage[],
): QuickNoteContextCandidate[] => {
  const snippetsByTopic = new Map<string, string[]>();

  for (const message of messages) {
    if (!message.topicId || !message.content?.trim()) continue;
    const snippets = snippetsByTopic.get(message.topicId) ?? [];
    if (snippets.length >= QUICK_NOTE_MESSAGE_SNIPPET_LIMIT) continue;

    const snippet = message.content.trim().slice(0, 600);
    if (!snippets.includes(snippet)) snippets.push(snippet);
    snippetsByTopic.set(message.topicId, snippets);
  }

  return topics.map((topic) => {
    const content = [
      topic.historySummary?.trim().slice(0, 1000),
      topic.description?.trim().slice(0, 600),
      topic.content?.trim().slice(0, 600),
      ...(snippetsByTopic.get(topic.id) ?? []),
    ]
      .filter((item): item is string => Boolean(item))
      .filter((item, index, items) => items.indexOf(item) === index)
      .join('\n');

    return {
      content: content || undefined,
      id: topic.id,
      title: topic.title,
      type: 'topic' as const,
    };
  });
};
