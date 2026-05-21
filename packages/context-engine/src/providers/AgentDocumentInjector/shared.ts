import type { AgentDocumentPolicyLoad } from '@lobechat/types';

import type {
  AgentDocumentLoadRule,
  AgentDocumentLoadRules,
} from '../../../../database/src/models/agentDocuments';
import { matchesLoadRules } from '../../../../database/src/models/agentDocuments';

export type { AgentDocumentLoadRule, AgentDocumentLoadRules };
export type { AgentDocumentPolicyLoad };

export const AGENT_DOCUMENT_INJECTION_POSITIONS = [
  'after-first-user',
  'before-first-user',
  'before-system',
  'context-end',
  'manual',
  'on-demand',
  'system-append',
  'system-replace',
] as const;

export type AgentDocumentInjectionPosition = (typeof AGENT_DOCUMENT_INJECTION_POSITIONS)[number];

export type AgentDocumentLoadFormat = 'file' | 'raw';

export type AgentDocumentSourceType = 'agent' | 'agent-signal' | 'api' | 'file' | 'topic' | 'web';

export interface AgentContextDocument {
  content?: string;
  description?: string;
  filename: string;
  id?: string;
  loadPosition?: AgentDocumentInjectionPosition;
  loadRules?: AgentDocumentLoadRules;
  policyId?: string | null;
  policyLoad?: AgentDocumentPolicyLoad;
  policyLoadFormat?: AgentDocumentLoadFormat;
  sourceType?: AgentDocumentSourceType;
  title?: string;
  updatedAt?: Date | string;
}

export interface AgentDocumentFilterContext {
  currentTime?: Date;
  currentUserMessage?: string;
  truncateContent?: (content: string, maxTokens: number) => string;
}

/**
 * Filter documents by load rules (always, by-keywords, by-regexp, by-time-range)
 */
export function filterDocumentsByRules(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): AgentContextDocument[] {
  return docs.filter((doc) =>
    matchesLoadRules(doc, {
      currentTime: context.currentTime,
      currentUserMessage: context.currentUserMessage,
    }),
  );
}

/**
 * Sort documents by priority (lower number = higher priority)
 */
export function sortByPriority(docs: AgentContextDocument[]): AgentContextDocument[] {
  return [...docs].sort((a, b) => {
    const aPriority = a.loadRules?.priority ?? 999;
    const bPriority = b.loadRules?.priority ?? 999;
    return aPriority - bPriority;
  });
}

/**
 * Get documents for specific positions, filtered and sorted
 */
export function getDocumentsForPositions(
  allDocuments: AgentContextDocument[],
  positions: AgentDocumentInjectionPosition[],
  context: AgentDocumentFilterContext,
): AgentContextDocument[] {
  const positionSet = new Set(positions);
  const docs = allDocuments.filter(
    (doc) =>
      doc.policyLoad !== 'disabled' && positionSet.has(doc.loadPosition || 'before-first-user'),
  );
  const filtered = filterDocumentsByRules(docs, context);
  return sortByPriority(filtered);
}

/**
 * Format a single document for injection
 */
export function formatDocument(
  doc: AgentContextDocument,
  context: AgentDocumentFilterContext,
): string {
  const maxTokens = doc.loadRules?.maxTokens;
  let content = doc.content || '';
  if (maxTokens && maxTokens > 0) {
    content = context.truncateContent
      ? context.truncateContent(content, maxTokens)
      : approximateTokenTruncate(content, maxTokens);
  }

  if (doc.policyLoadFormat === 'file') {
    const attributes = formatDocumentAttributes(doc);
    return `<agent_document${attributes}>\n${content}\n</agent_document>`;
  }

  return content;
}

/**
 * Format the size of a document content as a short human-readable token string.
 * Empty content is rendered as "empty" so the LLM does not retry reading it.
 */
function formatSize(content: string | undefined): string {
  const len = content?.length ?? 0;
  if (len === 0) return 'empty';
  if (len < 1000) return String(len);
  if (len < 10_000) return `${(len / 1000).toFixed(1)}k`;
  if (len < 1_000_000) return `${Math.round(len / 1000)}k`;
  return `${(len / 1_000_000).toFixed(1)}M`;
}

/**
 * Render a Date / ISO string as a short relative-time token like "2d ago".
 */
function formatRelative(at: Date | string | undefined, now: Date): string {
  if (!at) return '—';
  const date = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return '—';

  const sec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

const TITLE_MAX_WIDTH = 60;

function pickRowTitle(doc: AgentContextDocument): string {
  return doc.title || doc.filename || '(untitled)';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Render a list of progressive docs as a fixed-width table:
 *
 *   TITLE                ID                                    SIZE    UPDATED
 *   daily-brief.txt      2af6eb88-8bdb-468f-887f-620baa394efa  1.4k    2d ago
 */
function buildIndexTable(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): string {
  const now = context.currentTime ?? new Date();
  const rows = docs.map((d) => ({
    id: d.id ?? '',
    size: formatSize(d.content),
    title: truncate(pickRowTitle(d), TITLE_MAX_WIDTH),
    updated: formatRelative(d.updatedAt, now),
  }));

  const titleWidth = Math.max('TITLE'.length, ...rows.map((r) => r.title.length));
  const idWidth = Math.max('ID'.length, ...rows.map((r) => r.id.length));
  const sizeWidth = Math.max('SIZE'.length, ...rows.map((r) => r.size.length));

  const sep = '  ';
  const headerLine = [
    'TITLE'.padEnd(titleWidth),
    'ID'.padEnd(idWidth),
    'SIZE'.padEnd(sizeWidth),
    'UPDATED',
  ].join(sep);

  const dataLines = rows.map((row) =>
    [
      row.title.padEnd(titleWidth),
      row.id.padEnd(idWidth),
      row.size.padEnd(sizeWidth),
      row.updated,
    ].join(sep),
  );

  return [headerLine, ...dataLines].join('\n');
}

/**
 * Sort documents by recency (most-recently-updated first); rows missing
 * `updatedAt` sink to the end and keep stable input order between themselves.
 */
function sortByRecency(docs: AgentContextDocument[]): AgentContextDocument[] {
  return [...docs]
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const ta = a.doc.updatedAt ? new Date(a.doc.updatedAt).getTime() : 0;
      const tb = b.doc.updatedAt ? new Date(b.doc.updatedAt).getTime() : 0;
      if (tb !== ta) return tb - ta;
      return a.index - b.index;
    })
    .map(({ doc }) => doc);
}

/**
 * Combine multiple documents into a single string.
 * Progressive documents are grouped into an `<agent_documents_index>` block
 * (web-crawled docs are hidden behind a count and surfaced via listDocuments);
 * full-content documents are formatted individually.
 */
export function combineDocuments(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): string {
  // Missing `policyLoad` defaults to progressive (matches the DB default and
  // `AgentDocumentModel.createWithTx`'s fallback). A doc must be explicitly
  // marked `'always'` to land in the inline bucket; everything else that
  // survived `getDocumentsForPositions` (which already drops `'disabled'`)
  // is routed through the progressive index. Doing the default here means
  // hand-rolled `AgentContextDocument` callers can't silently lose their
  // content by forgetting the field.
  const fullDocs = docs.filter((d) => d.policyLoad === 'always');
  const progressiveDocs = docs.filter((d) => (d.policyLoad ?? 'progressive') === 'progressive');

  const parts: string[] = [];

  if (fullDocs.length > 0) {
    parts.push(fullDocs.map((doc) => formatDocument(doc, context)).join('\n\n'));
  }

  if (progressiveDocs.length > 0) {
    const userDocs = sortByRecency(progressiveDocs.filter((d) => d.sourceType !== 'web'));
    const hiddenWebCount = progressiveDocs.length - userDocs.length;

    const headerLines: string[] = [
      `${userDocs.length} user-created doc${userDocs.length === 1 ? '' : 's'}. Use readDocument(id) for full content.`,
    ];
    if (hiddenWebCount > 0) {
      headerLines.push(
        `${hiddenWebCount} web-crawled doc${hiddenWebCount === 1 ? '' : 's'} hidden — call listDocuments(sourceType='web') to see them.`,
      );
    }

    const tableBlock = userDocs.length > 0 ? `\n\n${buildIndexTable(userDocs, context)}` : '';

    parts.push(
      `<agent_documents_index>\n${headerLines.join('\n')}${tableBlock}\n</agent_documents_index>`,
    );
  }

  return parts.join('\n\n');
}

function approximateTokenTruncate(content: string, maxTokens: number): string {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return content;
  const parts = content.split(/\s+/);
  if (parts.length <= maxTokens) return content;
  return `${parts.slice(0, maxTokens).join(' ')}\n...[truncated]`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function formatDocumentAttributes(doc: AgentContextDocument): string {
  const attrs: string[] = [];
  if (doc.id) attrs.push(`id="${escapeAttribute(doc.id)}"`);
  if (doc.filename) attrs.push(`filename="${escapeAttribute(doc.filename)}"`);
  if (doc.title) attrs.push(`title="${escapeAttribute(doc.title)}"`);
  return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
}
