import { GoogleAnalytics as GA } from '@next/third-parties/google';

import { analyticsEnv } from '@/envs/analytics';

const GoogleAnalytics = () =>
  analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID ? (
    <GA gaId={analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID} />
  ) : null;

export default GoogleAnalytics;
