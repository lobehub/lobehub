import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    documentReferenceCount?: number;
    documentReferenceInjected?: boolean;
  }
}

const log = debug('context-engine:provider:DocumentReferenceContextInjector');

/** An agent document the user referenced with a `<refer_document>` tag. */
export interface DocumentReferenceItem {
  /** Document content, cut to the injection budget; absent when it could not be read. */
  content?: string;
  /** Agent-document id carried by the tag (`agent_documents.id`). */
  documentId: string;
  /** Referenced in an earlier turn only, so listed without content. */
  earlierTurn?: boolean;
  /** Document title */
  title?: string;
  /** Whether `content` was cut short of the full document */
  truncated?: boolean;
}

export interface DocumentReferenceContextInjectorConfig {
  documentReferences?: DocumentReferenceItem[];
  enabled?: boolean;
}

const escapeAttr = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

const formatDocumentReferences = (items: DocumentReferenceItem[]): string | null => {
  if (items.length === 0) return null;

  const lines: string[] = [
    '<referred_documents hint="The user referenced the following agent documents. Use their content as context. When a document is marked truncated, earlier_turn or unavailable, read it in full with the lobe-agent-documents readDocument tool using its id.">',
  ];

  for (const item of items) {
    const attrs = [
      `id="${escapeAttr(item.documentId)}"`,
      item.title ? `title="${escapeAttr(item.title)}"` : undefined,
      item.truncated ? 'truncated="true"' : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    if (item.earlierTurn) {
      lines.push(`<document ${attrs} status="earlier_turn" />`);
      continue;
    }

    if (item.content === undefined) {
      lines.push(`<document ${attrs} status="unavailable" />`);
      continue;
    }

    lines.push(`<document ${attrs}>`, item.content, '</document>');
  }

  lines.push('</referred_documents>');

  return lines.join('\n');
};

/**
 * Document Reference Context Injector
 *
 * When user messages contain `<refer_document>` tags, appends the referenced
 * agent documents' content to the last user message.
 */
export class DocumentReferenceContextInjector extends BaseLastUserContentProvider {
  readonly name = 'DocumentReferenceContextInjector';

  constructor(
    private config: DocumentReferenceContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const references = this.config.documentReferences;

    if (!this.config.enabled || !references || references.length === 0) {
      log('Document reference not enabled or no references, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formattedContent = formatDocumentReferences(references);
    if (!formattedContent) return this.markAsExecuted(clonedContext);

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);
    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'document_reference_context')
      : this.wrapWithSystemContext(formattedContent, 'document_reference_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.documentReferenceInjected = true;
    clonedContext.metadata.documentReferenceCount = references.length;

    return this.markAsExecuted(clonedContext);
  }
}
