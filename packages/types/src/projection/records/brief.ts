import type { BriefItem } from '../../brief';
import { defineProjectionFragmentNames } from '../runtime';

export interface BriefProjectionFragments {
  actions: Pick<BriefItem, 'actions'>;
  content: Pick<BriefItem, 'artifacts' | 'createdAt' | 'priority' | 'summary' | 'title' | 'type'>;
  readState: Pick<BriefItem, 'readAt'>;
  relations: Pick<BriefItem, 'agentId' | 'cronJobId' | 'taskId' | 'topicId' | 'userId'>;
  resolution: Pick<BriefItem, 'resolvedAction' | 'resolvedAt' | 'resolvedComment'>;
}

export const BRIEF_PROJECTION_FRAGMENT_NAMES =
  defineProjectionFragmentNames<BriefProjectionFragments>()([
    'actions',
    'content',
    'readState',
    'relations',
    'resolution',
  ]);
