'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Spin } from 'antd';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OFFICIAL_URL } from '@/const/url';
import { useIsCloudActive } from '@/hooks/useIsCloudActive';
import { remoteServerService } from '@/services/electron/remoteServer';
import { electronSystemService } from '@/services/electron/system';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

const PARTITION_ID = 'persist:subscription';

interface SubscriptionIframeWrapperProps {
  page: 'billing' | 'funds' | 'plans' | 'referral' | 'usage';
}

export const SubscriptionIframeWrapper = memo<SubscriptionIframeWrapperProps>(({ page }) => {
  const [sessionReady, setSessionReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const webviewRef = useRef<HTMLElement>(null);

  const { i18n } = useTranslation();
  const isCloudActive = useIsCloudActive();

  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);

  const iframeUrl = useMemo(() => {
    if (!isCloudActive) return null;

    const url = new URL(`/embed/subscription/${page}`, OFFICIAL_URL);
    // Sync locale to embed page via hl parameter
    if (i18n.language) {
      url.searchParams.set('hl', i18n.language);
    }
    return url.toString();
  }, [page, i18n.language, isCloudActive]);

  useEffect(() => {
    const initSession = async () => {
      try {
        await remoteServerService.setupSubscriptionWebviewSession(PARTITION_ID);
        setSessionReady(true);
      } catch (err) {
        console.error('Failed to initialize subscription webview session:', err);
        setError('Failed to initialize subscription session');
      }
    };

    initSession();
  }, []);

  // Intercept all link clicks in webview and open them in default browser
  // This webview only hosts the current page, any navigation should open externally
  useEffect(() => {
    const webview = webviewRef.current as any;
    if (!webview || !sessionReady) return;

    const LINK_CLICK_PREFIX = '__EXTERNAL_LINK__:';

    // Inject script to intercept all link clicks and window.open after DOM is ready
    const handleDomReady = () => {
      webview.executeJavaScript(`
        (function() {
          const PREFIX = '${LINK_CLICK_PREFIX}';

          // Intercept link clicks
          document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.href) {
              e.preventDefault();
              e.stopPropagation();
              // Use console.log with prefix to communicate with parent
              console.log(PREFIX + link.href);
            }
          }, true);

          // Intercept window.open calls
          const originalOpen = window.open;
          window.open = function(url, target, features) {
            if (url) {
              // Resolve relative URLs to absolute
              const absoluteUrl = new URL(url, window.location.href).href;
              console.log(PREFIX + absoluteUrl);
            }
            // Return null to indicate popup was blocked (expected behavior)
            return null;
          };
        })();
      `);
    };

    const handleConsoleMessage = (event: any) => {
      const message = event.message as string | undefined;
      if (message?.startsWith(LINK_CLICK_PREFIX)) {
        const url = message.slice(LINK_CLICK_PREFIX.length);
        electronSystemService.openExternalLink(url);
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('console-message', handleConsoleMessage);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('console-message', handleConsoleMessage);
    };
  }, [sessionReady]);

  const handleRetry = useCallback(() => {
    setError(null);
    setSessionReady(false);

    remoteServerService
      .setupSubscriptionWebviewSession(PARTITION_ID)
      .then(() => setSessionReady(true))
      .catch(() => setError('Failed to initialize subscription session'));
  }, []);

  if (!enableBusinessFeatures || !iframeUrl) return null;

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p>{error}</p>
        <button type="button" onClick={handleRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <Flexbox height={'100%'} width={'100%'}>
        <Center flex={1}>
          <Spin />
        </Center>
      </Flexbox>
    );
  }

  return (
    <webview
      partition={PARTITION_ID}
      ref={webviewRef}
      src={iframeUrl}
      style={{
        border: 0,
        inset: 0,
        position: 'absolute',
      }}
    />
  );
});

SubscriptionIframeWrapper.displayName = 'SubscriptionIframeWrapper';
