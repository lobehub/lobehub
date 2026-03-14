'use client';

import Script from 'next/script';
import { memo } from 'react';

interface NewRelicBrowserProps {
  accountId: string;
  applicationId: string;
  licenseKey: string;
}

const sanitize = (value: string) => value.replaceAll(/[^\w-]/g, '');

const NewRelicBrowser = memo<NewRelicBrowserProps>(({ accountId, applicationId, licenseKey }) => {
  const safeAccountId = sanitize(accountId);
  const safeAppId = sanitize(applicationId);
  const safeLicenseKey = sanitize(licenseKey);

  if (!safeAccountId || !safeAppId || !safeLicenseKey) return null;

  const snippet = [
    ';window.NREUM||(NREUM={})',
    `NREUM.init={distributed_tracing:{enabled:true},privacy:{cookies_enabled:true},ajax:{deny_list:["bam.nr-data.net"]}}`,
    `NREUM.info={beacon:"bam.nr-data.net",errorBeacon:"bam.nr-data.net",licenseKey:"${safeLicenseKey}",applicationID:"${safeAppId}",sa:1}`,
    `NREUM.loader_config={accountID:"${safeAccountId}",trustKey:"${safeAccountId}",agentID:"${safeAppId}",licenseKey:"${safeLicenseKey}",applicationID:"${safeAppId}"}`,
  ].join(';');

  return (
    <Script
      dangerouslySetInnerHTML={{ __html: snippet }}
      id="nr-browser-agent-config"
      strategy="beforeInteractive"
    />
  );
});

export default NewRelicBrowser;
