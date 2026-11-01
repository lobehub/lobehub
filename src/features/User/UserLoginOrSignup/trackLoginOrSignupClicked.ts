import { analyticsClient } from '@/libs/analytics/client';

import { resolveLandingClickId } from './landingClickId';

interface TrackLoginOrSignupClickedParams {
  provider?: string;
  spm: string;
}

export const trackLoginOrSignupClicked = ({ provider, spm }: TrackLoginOrSignupClickedParams) => {
  const lhCid = resolveLandingClickId();

  return analyticsClient
    .track({
      name: 'login_or_signup_clicked',
      properties: {
        ...(lhCid && { lh_cid: lhCid }),
        ...(provider && { provider }),
        spm,
      },
    })
    .catch((error) => {
      console.error('Failed to track login_or_signup_clicked:', error);
    });
};
