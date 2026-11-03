import { KnowledgeBaseApiName } from '../../types';
import { ReadKnowledgeInspector } from './ReadKnowledge';
import { SearchKnowledgeBaseInspector } from './SearchKnowledgeBase';

/**
 * Knowledge Base Inspector Components Registry
 */
export const KnowledgeBaseInspectors = {
  [KnowledgeBaseApiName.readKnowledge]: ReadKnowledgeInspector,
  [KnowledgeBaseApiName.searchKnowledgeBase]: SearchKnowledgeBaseInspector,
};
