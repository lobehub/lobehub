import type {
  AgentDocumentLoadRule,
  AgentDocumentLoadRules,
} from '../../../../database/src/models/agentDocuments';
import { matchesLoadRules } from '../../../../database/src/models/agentDocuments';

export type { AgentDocumentLoadRule, AgentDocumentLoadRules };

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

export interface AgentContextDocument {
  content?: string;
  filename: string;
  id?: string;
  loadPosition?: AgentDocumentInjectionPosition;
  loadRules?: AgentDocumentLoadRules;
  policyId?: string | null;
  policyLoadFormat?: AgentDocumentLoadFormat;
  title?: string;
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
  const docs = allDocuments.filter((doc) =>
    positionSet.has(doc.loadPosition || 'before-first-user'),
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
 * Combine multiple documents into a single string
 */
export function combineDocuments(
  docs: AgentContextDocument[],
  context: AgentDocumentFilterContext,
): string {
  return docs.map((doc) => formatDocument(doc, context)).join('\n\n');
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
