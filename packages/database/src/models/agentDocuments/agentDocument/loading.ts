import { isLoadableDocument, resolveDocumentLoadPosition, sortByLoadRulePriority } from '../policy';
import type { AgentDocumentWithRules, DocumentLoadPosition } from '../types';
import type { AgentDocumentContext } from './context';
import { findByAgent } from './queries';

export async function getDocumentsByPosition(
  ctx: AgentDocumentContext,
  agentId: string,
): Promise<Map<DocumentLoadPosition, AgentDocumentWithRules[]>> {
  const docs = await getLoadableDocuments(ctx, agentId);
  const grouped = new Map<DocumentLoadPosition, AgentDocumentWithRules[]>();

  for (const doc of docs) {
    const position = resolveDocumentLoadPosition(doc);
    const existing = grouped.get(position) || [];

    existing.push(doc);
    grouped.set(position, sortByLoadRulePriority(existing));
  }

  return grouped;
}

export async function getLoadableDocuments(
  ctx: AgentDocumentContext,
  agentId: string,
  _context?: {
    currentTime?: Date;
    userMessage?: string;
  },
): Promise<AgentDocumentWithRules[]> {
  // Autoload gate: only documents explicitly marked as always-loadable are injected.
  // Agent access bits are enforced by caller/tool layer for interactive list/read/write actions.
  const docs = await findByAgent(ctx, agentId);
  return docs.filter((doc) => isLoadableDocument(doc));
}

export async function getInjectableDocuments(
  ctx: AgentDocumentContext,
  agentId: string,
  context?: {
    currentTime?: Date;
    userMessage?: string;
  },
): Promise<AgentDocumentWithRules[]> {
  return getLoadableDocuments(ctx, agentId, context);
}

export async function getAgentContext(ctx: AgentDocumentContext, agentId: string): Promise<string> {
  const docs = await getLoadableDocuments(ctx, agentId);

  if (docs.length === 0) {
    return '';
  }

  const contextParts: string[] = [];

  for (const doc of docs) {
    if (doc.content) {
      contextParts.push(`--- ${doc.filename} ---`);
      contextParts.push(doc.content);
      contextParts.push('');
    }
  }

  return contextParts.join('\n').trim();
}
