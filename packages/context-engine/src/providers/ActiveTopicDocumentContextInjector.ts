import { escapeXmlAttr } from '@lobechat/prompts';
import type { RuntimeActiveTopicDocumentContext } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    activeTopicDocumentContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:ActiveTopicDocumentContextInjector');

export interface ActiveTopicDocumentContextInjectorConfig {
  activeTopicDocument?: RuntimeActiveTopicDocumentContext;
  enabled?: boolean;
}

const formatActiveTopicDocumentContext = (document: RuntimeActiveTopicDocumentContext) => {
  const attrs = [
    `document_id="${escapeXmlAttr(document.documentId)}"`,
    document.agentDocumentId
      ? `agent_document_id="${escapeXmlAttr(document.agentDocumentId)}"`
      : undefined,
    document.title ? `title="${escapeXmlAttr(document.title)}"` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return `<document ${attrs} />
<guidance>
The current conversation is not inside the page editor. Do not use PageAgent editor tools.
When the user asks to continue editing this topic document, use lobe-agent-documents tools instead.
Prefer readDocument with format="xml" and modifyNodes with agent_document_id when it is present.
If agent_document_id is missing, call listDocuments with target="currentTopic" and match document_id.
</guidance>`;
};

export class ActiveTopicDocumentContextInjector extends BaseLastUserContentProvider {
  readonly name = 'ActiveTopicDocumentContextInjector';

  constructor(
    private config: ActiveTopicDocumentContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const { activeTopicDocument, enabled } = this.config;

    if (!enabled || !activeTopicDocument?.documentId) {
      log('No active topic document context, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formattedContent = formatActiveTopicDocumentContext(activeTopicDocument);
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'active_topic_document')
      : this.wrapWithSystemContext(formattedContent, 'active_topic_document');

    this.appendToLastUserMessage(clonedContext, contentToAppend);
    clonedContext.metadata.activeTopicDocumentContextInjected = true;

    return this.markAsExecuted(clonedContext);
  }
}
