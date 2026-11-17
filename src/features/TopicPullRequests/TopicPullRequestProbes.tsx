import { memo, useEffect, useRef } from 'react';

import { useFetchGitPullRequestDetail } from '@/store/device';

/** A linked PR to read on the device; `version` changes whenever the topic touches it again. */
export interface TopicPullRequestProbe {
  number: number;
  version: number;
}

interface ProbeProps extends TopicPullRequestProbe {
  deviceId?: string;
  path: string;
}

/**
 * One `gh pr view <n>` read on the execution device. Persisted by the git
 * review replica, so an offline device still paints the last known state.
 * Inactive: no polling — the open sidebar PR tab polls the one it shows. A new
 * link version (the agent merged it, pushed to it…) re-reads it at once, so the
 * device answer never lags behind what the agent just did.
 */
const Probe = memo<ProbeProps>(({ deviceId, number, path, version }) => {
  const { mutate } = useFetchGitPullRequestDetail(deviceId, path, number, { active: false });
  const seen = useRef(version);

  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    void mutate();
  }, [mutate, version]);

  return null;
});

Probe.displayName = 'TopicPullRequestProbe';

interface TopicPullRequestProbesProps {
  deviceId?: string;
  path?: string;
  probes: TopicPullRequestProbe[];
}

/**
 * Reads the device state of linked pull requests. Renders nothing;
 * `useTopicPullRequests` picks the answers up.
 */
const TopicPullRequestProbes = memo<TopicPullRequestProbesProps>(({ deviceId, path, probes }) =>
  path ? (
    <>
      {probes.map((probe) => (
        <Probe deviceId={deviceId} key={probe.number} path={path} {...probe} />
      ))}
    </>
  ) : null,
);

TopicPullRequestProbes.displayName = 'TopicPullRequestProbes';

export default TopicPullRequestProbes;
