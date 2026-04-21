import { isDesktop } from '@/const/version';
import { analyticsEnv } from '@/envs/analytics';
import dynamic from '@/libs/next/dynamic';

import Desktop from './Desktop';
import Google from './Google';
import Vercel from './Vercel';
import X from './X';

const Plausible = dynamic(() => import('./Plausible'));
const Umami = dynamic(() => import('./Umami'));
const Clarity = dynamic(() => import('./Clarity'));
const ReactScan = dynamic(() => import('./ReactScan'));

const Analytics = () => {
  return (
    <>
      {analyticsEnv.ENABLE_VERCEL_ANALYTICS && (
        <Vercel debug={analyticsEnv.DEBUG_VERCEL_ANALYTICS} />
      )}
      {analyticsEnv.ENABLE_GOOGLE_ANALYTICS && (
        <Google gaId={analyticsEnv.GOOGLE_ANALYTICS_MEASUREMENT_ID} />
      )}
      {analyticsEnv.ENABLED_X_ADS && (
        <X
          eventIds={{
            login_or_signup_clicked: analyticsEnv.X_ADS_LOGIN_OR_SIGNUP_CLICKED_EVENT_ID,
            main_page_view: analyticsEnv.X_ADS_MAIN_PAGE_VIEW_EVENT_ID,
          }}
          pixelId={analyticsEnv.X_ADS_PIXEL_ID}
          purchaseEventId={analyticsEnv.X_ADS_PURCHASE_EVENT_ID}
        />
      )}
      {analyticsEnv.ENABLED_PLAUSIBLE_ANALYTICS && (
        <Plausible
          domain={analyticsEnv.PLAUSIBLE_DOMAIN}
          scriptBaseUrl={analyticsEnv.PLAUSIBLE_SCRIPT_BASE_URL}
        />
      )}
      {analyticsEnv.ENABLED_UMAMI_ANALYTICS && (
        <Umami
          scriptUrl={analyticsEnv.UMAMI_SCRIPT_URL}
          websiteId={analyticsEnv.UMAMI_WEBSITE_ID}
        />
      )}
      {analyticsEnv.ENABLED_CLARITY_ANALYTICS && (
        <Clarity projectId={analyticsEnv.CLARITY_PROJECT_ID} />
      )}
      {!!analyticsEnv.REACT_SCAN_MONITOR_API_KEY && (
        <ReactScan apiKey={analyticsEnv.REACT_SCAN_MONITOR_API_KEY} />
      )}
      {isDesktop && <Desktop />}
    </>
  );
};

export default Analytics;
