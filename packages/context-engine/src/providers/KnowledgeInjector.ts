import type { FileContent, KnowledgeBaseInfo } from '@lobechat/prompts';
import { promptAgentKnowledge } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:KnowledgeInjector');

export interface KnowledgeInjectorConfig {
  /** File contents to inject */
  fileContents?: FileContent[];
  /** Knowledge bases to inject */
  knowledgeBases?: KnowledgeBaseInfo[];
}

/**
 * Knowledge Injector
 * Responsible for injecting agent's knowledge (files and knowledge bases) into context
 * before the first user message
 */
export class KnowledgeInjector extends BaseFirstUserContentProvider {
  readonly name = 'KnowledgeInjector';

  constructor(
    private config: KnowledgeInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    const fileContents = this.config.fileContents || [];
    const knowledgeBases = this.config.knowledgeBases || [];

    // Generate unified knowledge prompt
    const formattedContent = promptAgentKnowledge({ fileContents, knowledgeBases });

    if (!formattedContent) {
      log('No knowledge to inject');
      return null;
    }

    log(
      `Knowledge prepared: ${fileContents.length} file(s), ${knowledgeBases.length} knowledge base(s)`,
    );

    return formattedContent;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    // Update metadata
    const fileContents = this.config.fileContents || [];
    const knowledgeBases = this.config.knowledgeBases || [];

    if (fileContents.length > 0 || knowledgeBases.length > 0) {
      result.metadata.knowledgeInjected = true;
      result.metadata.filesCount = fileContents.length;
      result.metadata.knowledgeBasesCount = knowledgeBases.length;
    }

    return result;
  }
}
