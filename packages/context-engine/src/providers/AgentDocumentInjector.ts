import type {
  AgentDocumentLoadRule,
  AgentDocumentLoadRules,
} from '../../../database/src/models/agentDocuments';
import { matchesLoadRules } from '../../../database/src/models/agentDocuments';
import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentDocuments?: {
      byPosition: Partial<Record<AgentDocumentInjectionPosition, number>>;
      injectedCount: number;
      policyIds: string[];
      providedCount: number;
    };
    agentDocumentsCount?: number;
    agentDocumentsInjected?: boolean;
  }
}

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

export interface AgentDocumentInjectorConfig {
  currentTime?: Date;
  currentUserMessage?: string;
  documents?: AgentContextDocument[];
  truncateContent?: (content: string, maxTokens: number) => string;
}

export class AgentDocumentInjector extends BaseProvider {
  readonly name = 'AgentDocumentInjector';

  constructor(
    private config: AgentDocumentInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const documents = this.config.documents || [];

    if (documents.length === 0) {
      return this.markAsExecuted(clonedContext);
    }

    const injectedCounts = new Map<AgentDocumentInjectionPosition, number>();
    const documentsByPosition = this.groupByPosition(documents);
    let injectedCount = 0;

    for (const [position, docs] of documentsByPosition.entries()) {
      const filteredDocs = this.filterByRules(docs);
      if (filteredDocs.length === 0) continue;

      switch (position) {
        case 'before-system': {
          this.injectBeforeSystem(clonedContext, filteredDocs);
          break;
        }
        case 'system-append': {
          this.appendToSystem(clonedContext, filteredDocs);
          break;
        }
        case 'system-replace': {
          this.replaceSystem(clonedContext, filteredDocs);
          break;
        }
        case 'before-first-user': {
          this.injectBeforeFirstUser(clonedContext, filteredDocs);
          break;
        }
        case 'after-first-user': {
          this.injectAfterFirstUser(clonedContext, filteredDocs);
          break;
        }
        case 'context-end': {
          this.injectAtEnd(clonedContext, filteredDocs);
          break;
        }
        case 'manual':
        case 'on-demand': {
          continue;
        }
      }

      injectedCount += filteredDocs.length;
      injectedCounts.set(position, (injectedCounts.get(position) || 0) + filteredDocs.length);
    }

    if (injectedCount === 0) return this.markAsExecuted(clonedContext);

    const policyIds = Array.from(
      new Set(
        documents.map((doc) => doc.policyId).filter((policyId): policyId is string => !!policyId),
      ),
    );

    clonedContext.metadata.agentDocumentsInjected = true;
    clonedContext.metadata.agentDocumentsCount = injectedCount;
    clonedContext.metadata.agentDocuments = {
      byPosition: Object.fromEntries(injectedCounts.entries()),
      injectedCount,
      policyIds,
      providedCount: documents.length,
    };

    return this.markAsExecuted(clonedContext);
  }

  private approximateTokenTruncate(content: string, maxTokens: number): string {
    if (!Number.isFinite(maxTokens) || maxTokens <= 0) return content;
    const parts = content.split(/\s+/);
    if (parts.length <= maxTokens) return content;
    return `${parts.slice(0, maxTokens).join(' ')}\n...[truncated]`;
  }

  private appendToSystem(context: PipelineContext, docs: AgentContextDocument[]): void {
    const systemMessage = context.messages.find((m) => m.role === 'system');
    if (systemMessage) {
      const content = this.combineDocuments(docs);
      systemMessage.content = `${systemMessage.content}\n\n${content}`;
    } else {
      this.injectBeforeSystem(context, docs);
    }
  }

  private combineDocuments(docs: AgentContextDocument[]): string {
    return docs.map((doc) => this.formatDocument(doc)).join('\n\n');
  }

  private filterByRules(docs: AgentContextDocument[]): AgentContextDocument[] {
    return docs.filter((doc) => {
      const context = {
        currentTime: this.config.currentTime,
        currentUserMessage: this.config.currentUserMessage,
      };
      return matchesLoadRules(doc, context);
    });
  }

  private formatDocument(doc: AgentContextDocument): string {
    const maxTokens = doc.loadRules?.maxTokens;
    let content = doc.content || '';
    if (maxTokens && maxTokens > 0) {
      content = this.config.truncateContent
        ? this.config.truncateContent(content, maxTokens)
        : this.approximateTokenTruncate(content, maxTokens);
    }

    if (doc.policyLoadFormat === 'file') {
      const attributes = this.formatDocumentAttributes(doc);
      return `<agent_document${attributes}>
${content}
</agent_document>`;
    }

    return content;
  }

  private formatDocumentAttributes(doc: AgentContextDocument): string {
    const attrs: string[] = [];

    if (doc.id) attrs.push(`id="${this.escapeAttribute(doc.id)}"`);
    if (doc.filename) attrs.push(`filename="${this.escapeAttribute(doc.filename)}"`);
    if (doc.title) attrs.push(`title="${this.escapeAttribute(doc.title)}"`);

    return attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  }

  private escapeAttribute(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  private getPosition(doc: AgentContextDocument): AgentDocumentInjectionPosition {
    return doc.loadPosition || 'before-first-user';
  }

  private groupByPosition(
    docs: AgentContextDocument[],
  ): Map<AgentDocumentInjectionPosition, AgentContextDocument[]> {
    const grouped = new Map<AgentDocumentInjectionPosition, AgentContextDocument[]>();

    for (const doc of docs) {
      const position = this.getPosition(doc);
      const existing = grouped.get(position) || [];
      existing.push(doc);
      grouped.set(position, existing);
    }

    for (const [position, groupDocs] of grouped.entries()) {
      groupDocs.sort((a, b) => {
        const aPriority = a.loadRules?.priority ?? 999;
        const bPriority = b.loadRules?.priority ?? 999;
        return aPriority - bPriority;
      });
      grouped.set(position, groupDocs);
    }

    return grouped;
  }

  private injectAfterFirstUser(context: PipelineContext, docs: AgentContextDocument[]): void {
    const firstUserIndex = context.messages.findIndex((m) => m.role === 'user');
    if (firstUserIndex === -1) return;

    const content = this.combineDocuments(docs);
    const now = Date.now();
    const message = {
      content,
      createdAt: now,
      id: `agent-doc-after-user-${now}`,
      role: 'system' as const,
      updatedAt: now,
    };

    context.messages.splice(firstUserIndex + 1, 0, message);
  }

  private injectAtEnd(context: PipelineContext, docs: AgentContextDocument[]): void {
    const content = this.combineDocuments(docs);
    const now = Date.now();
    const message = {
      content,
      createdAt: now,
      id: `agent-doc-context-end-${now}`,
      role: 'system' as const,
      updatedAt: now,
    };

    context.messages.push(message);
  }

  private injectBeforeFirstUser(context: PipelineContext, docs: AgentContextDocument[]): void {
    const firstUserIndex = context.messages.findIndex((m) => m.role === 'user');
    if (firstUserIndex === -1) return;

    const content = this.combineDocuments(docs);
    const now = Date.now();
    const message = {
      content,
      createdAt: now,
      id: `agent-doc-before-user-${now}`,
      role: 'system' as const,
      updatedAt: now,
    };

    context.messages.splice(firstUserIndex, 0, message);
  }

  private injectBeforeSystem(context: PipelineContext, docs: AgentContextDocument[]): void {
    const content = this.combineDocuments(docs);
    const now = Date.now();
    const message = {
      content,
      createdAt: now,
      id: `agent-doc-before-system-${now}`,
      role: 'system' as const,
      updatedAt: now,
    };

    context.messages.unshift(message);
  }

  private replaceSystem(context: PipelineContext, docs: AgentContextDocument[]): void {
    const systemIndex = context.messages.findIndex((m) => m.role === 'system');
    const content = this.combineDocuments(docs);
    const now = Date.now();
    const message = {
      content,
      createdAt: now,
      id: `agent-doc-system-${now}`,
      role: 'system' as const,
      updatedAt: now,
    };

    if (systemIndex >= 0) {
      context.messages[systemIndex] = message;
    } else {
      context.messages.unshift(message);
    }
  }
}
