import type { ProjectionFragmentName } from '@lobechat/types';
import { agentSearchIndexKey } from '@lobechat/types';

import { projectionRecordRequest, projectionRefsFromIndex } from '../../views/request';
import type { ProjectionViewContract } from '../../views/types';

export const AGENT_SUMMARY_FRAGMENTS = [
  'access',
  'identity',
  'profile',
  'runtime',
] as const satisfies readonly ProjectionFragmentName<'agent'>[];

export const AGENT_SIDEBAR_FRAGMENTS = [
  ...AGENT_SUMMARY_FRAGMENTS,
  'routing',
] as const satisfies readonly ProjectionFragmentName<'agent'>[];

export const AGENT_FULL_FRAGMENTS = [
  'access',
  'configuration',
  'identity',
  'knowledge',
  'lifecycle',
  'profile',
  'routing',
  'runtime',
] as const satisfies readonly ProjectionFragmentName<'agent'>[];

export const agentConfigViewContract: ProjectionViewContract<{ id: string }> = {
  key: ({ id }) => `agent.config:${id}`,
  records: (_scope, { id }) => [projectionRecordRequest('agent', [id], AGENT_FULL_FRAGMENTS)],
};

export const agentSummaryViewContract: ProjectionViewContract<{ id: string }> = {
  key: ({ id }) => `agent.summary:${id}`,
  records: (_scope, { id }) => [projectionRecordRequest('agent', [id], AGENT_SUMMARY_FRAGMENTS)],
};

const agentIndexContract = (
  key: 'agent.available' | 'agent.directory',
): ProjectionViewContract<Record<string, never>> => ({
  indexes: () => [key],
  key: () => key,
  records: (scope) => [
    projectionRecordRequest(
      'agent',
      projectionRefsFromIndex(scope?.indexes[key]).map((ref) => ref.id),
      AGENT_SUMMARY_FRAGMENTS,
    ),
  ],
});

export const agentAvailableViewContract = agentIndexContract('agent.available');
export const agentDirectoryViewContract = agentIndexContract('agent.directory');

export const agentSearchViewContract: ProjectionViewContract<{ keyword?: string }> = {
  indexes: ({ keyword }) => [agentSearchIndexKey(keyword)],
  key: ({ keyword }) => agentSearchIndexKey(keyword),
  records: (scope, { keyword }) => {
    const refs = projectionRefsFromIndex(scope?.indexes[agentSearchIndexKey(keyword)]);
    return [
      projectionRecordRequest(
        'agent',
        refs.filter((ref) => ref.kind === 'agent').map((ref) => ref.id),
        AGENT_SIDEBAR_FRAGMENTS,
      ),
      projectionRecordRequest(
        'chatGroup',
        refs.filter((ref) => ref.kind === 'chatGroup').map((ref) => ref.id),
        ['access', 'identity'],
      ),
    ];
  },
};
