import type { ProjectionFragmentName } from '@lobechat/types';
import { chatAgentViewTopicsIndexKey, chatSidebarTopicsIndexKey } from '@lobechat/types';

import { projectionRecordRequest, projectionRefsFromIndex } from '../../views/request';
import type { ProjectionViewContract } from '../../views/types';

const TOPIC_LIST_FRAGMENTS = [
  'activity',
  'analytics',
  'completion',
  'creation',
  'display',
  'generation',
  'marking',
  'ordering',
  'ownership',
  'routing',
  'status',
  'summary',
] as const satisfies readonly ProjectionFragmentName<'topic'>[];

export interface ChatTopicsViewParams {
  containerKey: string;
  surface: 'agentView' | 'sidebar';
  withDetails?: boolean;
}

export const chatTopicsViewContract: ProjectionViewContract<ChatTopicsViewParams> = {
  indexes: ({ containerKey, surface }) => [
    surface === 'agentView'
      ? chatAgentViewTopicsIndexKey(containerKey)
      : chatSidebarTopicsIndexKey(containerKey),
  ],
  key: ({ containerKey, surface, withDetails }) =>
    `chat.${surface}:${containerKey}:${withDetails ? 'detail' : 'list'}`,
  records: (scope, { containerKey, surface, withDetails }) => {
    const key =
      surface === 'agentView'
        ? chatAgentViewTopicsIndexKey(containerKey)
        : chatSidebarTopicsIndexKey(containerKey);
    return [
      projectionRecordRequest(
        'topic',
        projectionRefsFromIndex(scope?.indexes[key]).map((ref) => ref.id),
        withDetails ? [...TOPIC_LIST_FRAGMENTS, 'details', 'triggerInfo'] : TOPIC_LIST_FRAGMENTS,
      ),
    ];
  },
};
