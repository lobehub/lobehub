// Fixture: the field is normalized once where it is read.
import { memo } from 'react';

import type { AcceptanceBundle } from '@/services/verify';

interface PullRequestLinksProps {
  pullRequests?: AcceptanceBundle['pullRequests'];
}

const PullRequestLinks = memo<PullRequestLinksProps>(({ pullRequests = [] }) => {
  if (pullRequests.length === 0) return null;

  return (
    <>
      {pullRequests.map((pullRequest) => (
        <a href={pullRequest.url} key={pullRequest.url}>
          #{pullRequest.number}
        </a>
      ))}
    </>
  );
});

export default PullRequestLinks;
