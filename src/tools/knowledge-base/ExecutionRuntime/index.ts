import { KnowledgeBaseExecutionRuntime as BaseKnowledgeBaseExecutionRuntime } from '@lobechat/builtin-tool-knowledge-base/executionRuntime';
import type { ReadKnowledgeArgs, SearchKnowledgeBaseArgs } from '@lobechat/builtin-tool-knowledge-base';

import { ragService } from '@/services/rag';

// Create a factory that returns an instance with ragService injected
export class KnowledgeBaseExecutionRuntime extends BaseKnowledgeBaseExecutionRuntime {
  constructor() {
    super(ragService);
  }

  searchKnowledgeBase(
    args: SearchKnowledgeBaseArgs,
    options?: Parameters<BaseKnowledgeBaseExecutionRuntime['searchKnowledgeBase']>[1],
  ) {
    return super.searchKnowledgeBase(args, options);
  }

  readKnowledge(args: ReadKnowledgeArgs, options?: Parameters<BaseKnowledgeBaseExecutionRuntime['readKnowledge']>[1]) {
    return super.readKnowledge(args, options);
  }
}

// Re-export types for convenience
export type { ReadKnowledgeArgs, SearchKnowledgeBaseArgs } from '@lobechat/builtin-tool-knowledge-base';
