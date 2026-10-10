import Fuse, { type FuseResult } from 'fuse.js';

export interface SearchableEntry {
  /** Lowercased searchable texts (label / desc / keywords / pinyin variants) */
  haystack: string[];
  /** Result key (`tab-*` / `item-*` / `provider-*` / `connector-*`) */
  key: string;
}

/**
 * Fuzzy matches crowd a small sidebar panel fast, so cap how many we show —
 * anything below the top 20 is noise for a settings query.
 */
export const MAX_SEARCH_RESULTS = 20;

/**
 * Short tokens that are also substrings of many provider ids (`newapi`,
 * `search1api`, `cometapi`). Exact keyword hits on tabs/items must outrank
 * those name collisions.
 */
export const GENERIC_PROVIDER_QUERIES = new Set(['ai', 'api', 'key', 'model']);

export type SettingsSearchResultKind = 'connector' | 'item' | 'provider' | 'tab';

const KIND_RANK: Record<SettingsSearchResultKind, number> = {
  connector: 2,
  item: 1,
  provider: 3,
  tab: 0,
};

/**
 * Result keys are prefixed by their index source.
 */
export const getSettingsSearchResultKind = (resultKey: string): SettingsSearchResultKind => {
  if (resultKey.startsWith('item-')) return 'item';
  if (resultKey.startsWith('provider-')) return 'provider';
  if (resultKey.startsWith('connector-')) return 'connector';
  return 'tab';
};

/**
 * Fuzzy matcher over the settings index. Compared to the ChatInput Fuse usages
 * (threshold 0.3–0.4 over short command labels), the settings haystack includes
 * longer description texts, so `ignoreLocation` keeps matches deep inside a
 * description from being scored away; threshold 0.35 tolerates a typo or two
 * without flooding the panel with unrelated entries. Results are score-sorted,
 * and Fuse keeps insertion order on ties — the index lists tab entries first,
 * so tabs still rank above item-level matches when equally relevant.
 */
export const createSettingsSearchFuse = <T extends SearchableEntry>(entries: T[]) =>
  new Fuse(entries, {
    ignoreLocation: true,
    // rankHits breaks kind-rank ties by score, so scores must be real numbers
    // rather than the undefined Fuse returns by default
    includeScore: true,
    keys: ['haystack'],
    threshold: 0.35,
  });

/**
 * Split a query so `model provider` and `tts设置` can fall back to per-token
 * matches when the whole string misses. Does not enable Fuse extended-search
 * (quotes / `=` / `!` would hijack real user input like `a'pi`).
 */
export const tokenizeSettingsQuery = (query: string): string[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return normalized
    .split(
      /(?<=\p{Script=Han})(?=[\p{Script=Latin}\p{Nd}])|(?<=[\p{Script=Latin}\p{Nd}])(?=\p{Script=Han})|\s+/u,
    )
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
};

/**
 * How literally an entry matches the query. Fuse scores alone rank a fuzzy
 * near-miss (`api` ≈ `appearance`) on par with a literal keyword hit, and the
 * generic-query kind demotion then lifted those near-misses above providers
 * literally named after the query (`New API` sat at position 12–13 in PostHog
 * click data). Literal tiers are compared first; Fuse score only breaks ties.
 */
export enum MatchTier {
  Exact = 0,
  /** A haystack text or one of its words starts with the query */
  Prefix = 1,
  Substring = 2,
  Fuzzy = 3,
}

const WORD_SEPARATOR = /[\s\-_/,.:()·›]+/;

export const getMatchTier = (haystack: string[], query: string): MatchTier => {
  let tier = MatchTier.Fuzzy;

  for (const text of haystack) {
    if (text === query) return MatchTier.Exact;
    if (tier <= MatchTier.Prefix) continue;
    if (text.startsWith(query) || text.split(WORD_SEPARATOR).some((w) => w.startsWith(query)))
      tier = MatchTier.Prefix;
    else if (tier > MatchTier.Substring && text.includes(query)) tier = MatchTier.Substring;
  }

  return tier;
};

/**
 * At threshold 0.35 a single edit is enough for a 3-character query to match
 * (`api` ≈ `email` / `appearance`), so short queries pulled in near-misses that
 * filled the 20-result cap. Up to this length, fuzzy hits are dropped whenever
 * a literal match exists; with no literal match they stay, so typos still work.
 */
const SHORT_QUERY_LENGTH = 3;

interface RankedHit<T> {
  item: T;
  score: number;
  tier: MatchTier;
}

const toHits = <T extends SearchableEntry>(
  results: FuseResult<T>[],
  query: string,
): RankedHit<T>[] => {
  const normalized = query.trim().toLowerCase();

  return results.map((result) => ({
    item: result.item,
    score: result.score ?? 0,
    tier: getMatchTier(result.item.haystack, normalized),
  }));
};

const intersectTokenHits = <T extends SearchableEntry>(
  fuse: Fuse<T>,
  tokens: string[],
  query: string,
): RankedHit<T>[] => {
  const [first, ...rest] = tokens;
  if (!first) return [];

  const firstHits = toHits(fuse.search(first), query);
  if (rest.length === 0) return firstHits;

  const restKeys = rest.map((token) => new Set(fuse.search(token).map((hit) => hit.item.key)));

  return firstHits.filter((hit) => restKeys.every((keys) => keys.has(hit.item.key)));
};

const dropShortQueryFuzzyHits = <T>(hits: RankedHit<T>[], query: string): RankedHit<T>[] => {
  if ([...query].length > SHORT_QUERY_LENGTH) return hits;

  const literal = hits.filter((hit) => hit.tier !== MatchTier.Fuzzy);
  return literal.length > 0 ? literal : hits;
};

const rankHits = <T extends SearchableEntry>(hits: RankedHit<T>[], query: string): T[] => {
  const normalized = query.trim().toLowerCase();
  const shouldDemoteProviders = GENERIC_PROVIDER_QUERIES.has(normalized);

  // Array#sort is stable, so equal hits keep Fuse order (tabs are indexed first).
  const ordered = dropShortQueryFuzzyHits(hits, normalized).sort((left, right) => {
    const tierDelta = left.tier - right.tier;
    if (tierDelta !== 0) return tierDelta;

    if (shouldDemoteProviders) {
      const kindDelta =
        KIND_RANK[getSettingsSearchResultKind(left.item.key)] -
        KIND_RANK[getSettingsSearchResultKind(right.item.key)];
      if (kindDelta !== 0) return kindDelta;
    }

    return left.score - right.score;
  });

  return ordered.slice(0, MAX_SEARCH_RESULTS).map((hit) => hit.item);
};

/**
 * Search the settings index: full query first, then token-AND, then the first
 * token. Fuse runs uncapped (the index is a few hundred entries) so literal
 * matches beyond Fuse's own top 20 can still be ranked in before the cut.
 * Generic tokens like `api` keep tab/item hits above provider-name collisions
 * within the same match tier.
 */
export const searchSettingsIndex = <T extends SearchableEntry>(
  fuse: Fuse<T>,
  query: string,
): T[] => {
  const raw = query.trim();
  if (!raw) return [];

  const primary = rankHits(toHits(fuse.search(raw), raw), raw);
  if (primary.length > 0) return primary;

  const tokens = tokenizeSettingsQuery(raw);
  if (tokens.length > 1) {
    const andHits = intersectTokenHits(fuse, tokens, raw);
    if (andHits.length > 0) return rankHits(andHits, raw);
  }

  const fallbackToken = tokens[0];
  if (fallbackToken && fallbackToken !== raw.toLowerCase()) {
    return rankHits(toHits(fuse.search(fallbackToken), fallbackToken), fallbackToken);
  }

  return [];
};
