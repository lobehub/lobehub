import type { BriefItem } from '../../brief';

export interface BriefProjectionFragments {
  actions: Pick<BriefItem, 'actions'>;
  content: Pick<BriefItem, 'artifacts' | 'createdAt' | 'priority' | 'summary' | 'title' | 'type'>;
  readState: Pick<BriefItem, 'readAt'>;
  relations: Pick<BriefItem, 'agentId' | 'cronJobId' | 'taskId' | 'topicId' | 'userId'>;
  resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>;
}
