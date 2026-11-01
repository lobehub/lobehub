import { toRecord } from '@lobechat/utils/object';

import type { NotionItem } from './types';

const MAX_ITEM_ID_LENGTH = 128;
const MAX_MARKDOWN_LENGTH = 32_000;
const MAX_PROPERTY_COUNT = 32;
const MAX_PROPERTY_NAME_LENGTH = 160;
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2048;

const executionWrappers = ['data', 'result', 'response'] as const;
const collectionKeys = ['results', 'items', 'pages', 'databases'] as const;

const boundedString = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== 'string') return;
  const normalized = value.trim().slice(0, limit);
  return normalized || undefined;
};

const readRichText = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return;
  const text = value
    .slice(0, 32)
    .flatMap((entry) => {
      const record = toRecord(entry);
      const nestedText = toRecord(record?.text);
      const content = record?.plain_text ?? nestedText?.content;
      return typeof content === 'string' ? [content] : [];
    })
    .join(' ');
  return boundedString(text, MAX_TITLE_LENGTH);
};

const readTitle = (record: Record<string, unknown>): string => {
  const direct = boundedString(record.title ?? record.name, MAX_TITLE_LENGTH);
  if (direct) return direct;

  const databaseTitle = readRichText(record.title);
  if (databaseTitle) return databaseTitle;

  const properties = toRecord(record.properties);
  if (properties) {
    for (const [propertyName, value] of Object.entries(properties).slice(0, MAX_PROPERTY_COUNT)) {
      const property = toRecord(value);
      const richTitle = readRichText(property?.title);
      if (richTitle) return richTitle;
      if (property?.type === 'title') {
        const fallback = boundedString(propertyName, MAX_TITLE_LENGTH);
        if (fallback) return fallback;
      }
    }
  }
  return 'Untitled';
};

const readCollection = (value: unknown): unknown[] | undefined => {
  const queue: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];

  // Composio SDK versions wrap tool data differently. Traverse only known execution wrappers and
  // stop at a shallow depth so an untrusted page property named `results` cannot become a response.
  while (queue.length > 0) {
    const current = queue.shift()!;
    const record = toRecord(current.value);
    if (!record) continue;
    for (const key of collectionKeys) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
    if (Array.isArray(record.data)) return record.data;
    if (current.depth >= 3) continue;
    for (const key of executionWrappers) {
      if (record[key] !== undefined) queue.push({ depth: current.depth + 1, value: record[key] });
    }
  }
};

/**
 * Normalizes a Notion UUID for stable browser URLs.
 *
 * Before:
 * - `12345678-1234-1234-1234-123456789abc`
 *
 * After:
 * - `12345678123412341234123456789abc`
 */
const normalizeNotionIdForUrl = (id: string): string => id.replaceAll('-', '');

/**
 * Normalizes Composio Notion directory output into bounded connector records.
 *
 * Before:
 * - `{ data: { results: [{ object: "page", id: "...", properties: { Name: { title: [...] } } }] } }`
 *
 * After:
 * - `[{ kind: "page", id: "...", title: "...", sourceUrl: "https://www.notion.so/..." }]`
 */
export const parseNotionItems = (value: unknown, maxCandidates: number): NotionItem[] | undefined => {
  const collection = readCollection(value);
  if (!collection) return;
  const finiteLimit = Number.isFinite(maxCandidates) ? Math.floor(maxCandidates) : 0;
  const limit = Math.min(Math.max(0, finiteLimit), 100);
  const items = new Map<string, NotionItem>();

  for (const candidate of collection.slice(0, limit)) {
    const record = toRecord(candidate);
    const id = boundedString(record?.id, MAX_ITEM_ID_LENGTH);
    if (!record || !id || items.has(id)) continue;
    const rawKind = record.object ?? record.type;
    const kind = rawKind === 'database' ? 'database' : rawKind === 'page' ? 'page' : undefined;
    if (!kind) continue;
    const properties = toRecord(record.properties);
    const rawUrl = boundedString(record.url, MAX_URL_LENGTH);
    const lastEditedAt = boundedString(
      record.last_edited_time ?? record.lastEditedAt,
      64,
    );
    items.set(id, {
      id,
      kind,
      ...(lastEditedAt ? { lastEditedAt } : {}),
      propertyNames: properties
        ? Object.keys(properties)
            .slice(0, MAX_PROPERTY_COUNT)
            .map((name) => name.trim().slice(0, MAX_PROPERTY_NAME_LENGTH))
            .filter(Boolean)
        : [],
      sourceUrl: rawUrl ?? `https://www.notion.so/${normalizeNotionIdForUrl(id)}`,
      title: readTitle(record),
    });
  }

  if (collection.length > 0 && limit > 0 && items.size === 0) return;
  return [...items.values()];
};

/**
 * Normalizes Composio Notion page content into bounded Markdown.
 *
 * Before:
 * - `{ data: { markdown: "# Project\n- [ ] Ship" } }`
 *
 * After:
 * - `"# Project\n- [ ] Ship"`
 */
export const parseNotionPageMarkdown = (value: unknown): string | undefined => {
  const queue: Array<{ depth: number; value: unknown }> = [{ depth: 0, value }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const record = toRecord(current.value);
    if (!record) continue;
    const markdown = boundedString(record.markdown ?? record.content, MAX_MARKDOWN_LENGTH);
    if (markdown) return markdown;
    if (current.depth >= 3) continue;
    for (const key of executionWrappers) {
      if (record[key] !== undefined) queue.push({ depth: current.depth + 1, value: record[key] });
    }
  }
};
