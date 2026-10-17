// Fixture: the incident — a prop typed as a slice of the server bundle, read as an array.
import { memo } from 'react';

import type { AcceptanceBundle } from '@/services/verify';

interface PullRequestLinksProps {
  pullRequests: AcceptanceBundle['pullRequests'];
}

const PullRequestLinks = memo<PullRequestLinksProps>(({ pullRequests }) => {
  // alint-expect
  if (pullRequests.length === 0) return null;

  return (
    <>
      {/* alint-expect */}
      {pullRequests.map((pullRequest) => (
        <a href={pullRequest.url} key={pullRequest.url}>
          #{pullRequest.number}
        </a>
      ))}
    </>
  );
});

export default PullRequestLinks;
