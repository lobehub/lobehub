import type { ProjectionFragmentName } from '@lobechat/types';

import { projectionRecordRequest, projectionRefsFromIndex } from '../../views/request';
import type { ProjectionViewContract } from '../../views/types';
import { AGENT_FULL_FRAGMENTS } from '../agent/contracts';

const CHAT_GROUP_LIST_FRAGMENTS = [
  'access',
  'identity',
  'lifecycle',
] as const satisfies readonly ProjectionFragmentName<'chatGroup'>[];

const CHAT_GROUP_DETAIL_FRAGMENTS = [
  ...CHAT_GROUP_LIST_FRAGMENTS,
  'configuration',
  'membership',
] as const satisfies readonly ProjectionFragmentName<'chatGroup'>[];

export const chatGroupListViewContract: ProjectionViewContract<Record<string, never>> = {
  indexes: () => ['chatGroup.list'],
  key: () => 'chatGroup.list',
  records: (scope) => [
    projectionRecordRequest(
      'chatGroup',
      projectionRefsFromIndex(scope?.indexes['chatGroup.list']).map((ref) => ref.id),
      CHAT_GROUP_LIST_FRAGMENTS,
    ),
  ],
};

export const chatGroupDetailViewContract: ProjectionViewContract<{ id: string }> = {
  key: ({ id }) => `chatGroup.detail:${id}`,
  records: (scope, { id }) => {
    const members = scope?.records.chatGroup[id]?.fragments.membership?.data.agents ?? [];
    return [
      projectionRecordRequest('chatGroup', [id], CHAT_GROUP_DETAIL_FRAGMENTS),
      projectionRecordRequest(
        'agent',
        members.map((member) => member.id),
        AGENT_FULL_FRAGMENTS,
      ),
    ];
  },
};
