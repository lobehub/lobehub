'use client';

import { useEffect, useState } from 'react';

import useSocialConnect, { type ClaimableResources } from './useSocialConnect';

interface UseSocialConnectionsOptions {
  /**
   * Fetch the connection status of every provider whenever this becomes true
   */
  enabled: boolean;
  onClaimableResourcesFound?: (resources: ClaimableResources) => void;
}

export const useSocialConnections = ({
  enabled,
  onClaimableResourcesFound,
}: UseSocialConnectionsOptions) => {
  const github = useSocialConnect({ onClaimableResourcesFound, provider: 'github' });
  const twitter = useSocialConnect({ onClaimableResourcesFound, provider: 'twitter' });

  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);

  // `useSocialConnect` returns a new object every render; depend on its stable
  // `fetchProfile` callbacks so the lookup runs once per enable, not once per render.
  const fetchGithubProfile = github.fetchProfile;
  const fetchTwitterProfile = twitter.fetchProfile;

  useEffect(() => {
    if (!enabled) return;

    const fetchProfiles = async () => {
      setIsLoadingProfiles(true);
      try {
        await Promise.all([fetchGithubProfile(), fetchTwitterProfile()]);
      } finally {
        setIsLoadingProfiles(false);
      }
    };
    fetchProfiles();
  }, [enabled, fetchGithubProfile, fetchTwitterProfile]);

  return { github, isLoadingProfiles, twitter };
};

export default useSocialConnections;
