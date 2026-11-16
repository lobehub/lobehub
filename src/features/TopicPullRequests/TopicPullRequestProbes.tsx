import { memo } from 'react';

import { useFetchGitPullRequestDetail } from '@/store/device';

interface ProbeProps {
  deviceId?: string;
  number: number;
  path: string;
}

/**
 * One `gh pr view <n>` read on the execution device. Persisted by the git
 * review replica, so an offline device still paints the last known state.
 * Inactive: no polling — the open sidebar PR tab polls the one it shows.
 */
const Probe = memo<ProbeProps>(({ deviceId, number, path }) => {
  useFetchGitPullRequestDetail(deviceId, path, number, { active: false });
  return null;
});

Probe.displayName = 'TopicPullRequestProbe';

interface TopicPullRequestProbesProps {
  deviceId?: string;
  numbers: number[];
  path?: string;
}

/**
 * Reads the device state of linked pull requests the GitHub App does not
 * report on. Renders nothing; `useTopicPullRequests` picks the answers up.
 */
const TopicPullRequestProbes = memo<TopicPullRequestProbesProps>(({ deviceId, numbers, path }) =>
  path ? (
    <>
      {numbers.map((number) => (
        <Probe deviceId={deviceId} key={number} number={number} path={path} />
      ))}
    </>
  ) : null,
);

TopicPullRequestProbes.displayName = 'TopicPullRequestProbes';

export default TopicPullRequestProbes;
