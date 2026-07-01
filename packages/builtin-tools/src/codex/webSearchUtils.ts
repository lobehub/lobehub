'use client';

export interface CodexWebSearchArgs extends Record<string, unknown> {
  action?: unknown;
  query?: unknown;
  queries?: unknown;
  results?: unknown;
  search_query?: unknown;
  searchQuery?: unknown;
}

export interface CodexWebSearchResult {
  snippet?: string;
  title: string;
  url?: string;
}

const QUERY_KEYS = [
  'query',
  'queries',
  'search_query',
  'searchQuery',
  'q',
  'keyword',
  'keywords',
  'term',
];
const NESTED_ARG_KEYS = [
  'args',
  'arguments',
  'input',
  'params',
  'request',
  'payload',
  'data',
  'action',
];
const RESULT_KEYS = ['results', 'search_results', 'searchResults', 'items', 'sources', 'citations'];
const TITLE_KEYS = ['title', 'name', 'pageTitle', 'source'];
const URL_KEYS = ['url', 'link', 'href', 'sourceUrl'];
const SNIPPET_KEYS = ['snippet', 'summary', 'description', 'text', 'content'];

const MAX_RESULTS = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const stripTrailingUrlPunctuation = (value: string) => value.replace(/[),.;\]]+$/u, '');

const stripNumberPrefix = (value: string) => {
  const trimmed = value.trim();
  const marker = trimmed.match(/^\d+[).]\s+/u);

  return marker ? trimmed.slice(marker[0].length).trim() : trimmed;
};

const stripLeadingSeparator = (value: string) => value.replace(/^[-–—:]\s+/u, '').trim();

const stripTrailingSeparator = (value: string) => value.replace(/\s+[-–—:]$/u, '').trim();

const getStringFromRecord = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value) return value;
  }

  return '';
};

const getQueryFromValue = (value: unknown): string => {
  const direct = normalizeString(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const item of value) {
      const query = getQueryFromValue(item);
      if (query) return query;
    }
  }

  if (isRecord(value)) {
    return getStringFromRecord(value, QUERY_KEYS);
  }

  return '';
};

const getNestedRecords = (args?: unknown) => {
  if (!isRecord(args)) return [];

  const records: Record<string, unknown>[] = [args];
  for (const key of NESTED_ARG_KEYS) {
    const nested = args[key];
    if (isRecord(nested)) records.push(nested);
  }

  return records;
};

export const getWebSearchQuery = (args?: unknown) => {
  for (const record of getNestedRecords(args)) {
    for (const key of QUERY_KEYS) {
      const query = getQueryFromValue(record[key]);
      if (query) return query;
    }
  }

  return '';
};

const getResultFromRecord = (record: Record<string, unknown>): CodexWebSearchResult | undefined => {
  const title = getStringFromRecord(record, TITLE_KEYS);
  const url = getStringFromRecord(record, URL_KEYS);
  const snippet = getStringFromRecord(record, SNIPPET_KEYS);

  if (!title && !url && !snippet) return;

  return {
    snippet: snippet || undefined,
    title: title || url || snippet,
    url: url || undefined,
  };
};

const getResultsFromValue = (value: unknown): CodexWebSearchResult[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecord(item) ? getResultFromRecord(item) : undefined))
      .filter((item): item is CodexWebSearchResult => !!item)
      .slice(0, MAX_RESULTS);
  }

  if (isRecord(value)) {
    for (const key of RESULT_KEYS) {
      const results = getResultsFromValue(value[key]);
      if (results.length > 0) return results;
    }

    const result = getResultFromRecord(value);
    return result ? [result] : [];
  }

  return [];
};

const parseMarkdownResultLine = (line: string): CodexWebSearchResult | undefined => {
  const normalized = stripNumberPrefix(line);
  if (!normalized.startsWith('[')) return;

  const titleEnd = normalized.indexOf('](');
  if (titleEnd <= 1) return;

  const urlStart = titleEnd + 2;
  const urlEnd = normalized.indexOf(')', urlStart);
  if (urlEnd <= urlStart) return;

  const title = normalized.slice(1, titleEnd).trim();
  const url = stripTrailingUrlPunctuation(normalized.slice(urlStart, urlEnd).trim());
  if (!title || !url) return;

  const snippet = stripLeadingSeparator(normalized.slice(urlEnd + 1));

  return {
    snippet: snippet || undefined,
    title,
    url,
  };
};

const parseTextResultLine = (line: string): CodexWebSearchResult | undefined => {
  const normalized = stripNumberPrefix(line);
  const urlMatch = normalized.match(/https?:\/\/\S+/u);
  if (!urlMatch?.[0]) return;

  const urlStart = urlMatch.index ?? 0;
  const urlEnd = urlStart + urlMatch[0].length;
  const url = stripTrailingUrlPunctuation(urlMatch[0]);
  const beforeUrl = stripTrailingSeparator(normalized.slice(0, urlStart));
  const afterUrl = stripLeadingSeparator(normalized.slice(urlEnd));
  const title = beforeUrl || afterUrl;

  if (!title || !url) return;

  return {
    title,
    url,
  };
};

const getResultsFromContent = (content?: string): CodexWebSearchResult[] => {
  if (!content) return [];

  return content
    .split('\n')
    .map((line) => parseMarkdownResultLine(line) || parseTextResultLine(line))
    .filter((item): item is CodexWebSearchResult => !!item)
    .slice(0, MAX_RESULTS);
};

export const getWebSearchResults = (args?: unknown, content?: string) => {
  for (const record of getNestedRecords(args)) {
    for (const key of RESULT_KEYS) {
      const results = getResultsFromValue(record[key]);
      if (results.length > 0) return results;
    }
  }

  return getResultsFromContent(content);
};

export const getWebSearchOutput = (content?: string) => {
  const output = content?.trim() || '';
  if (/^Completed web_search\.?$/iu.test(output)) return '';

  return output;
};
