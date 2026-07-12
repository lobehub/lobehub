import { isDesktop } from '@lobechat/const';
import { ActionIcon, Center, Empty, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Import,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { BrowserIcon } from '@/components/BrowserIcon';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { electronBrowserSidebarService } from '@/services/electron/browserSidebar';
import { useGlobalStore } from '@/store/global';

import AgentOverlay from './AgentOverlay';
import { BROWSER_WEBVIEW_PARTITION, BROWSER_WEBVIEW_SESSION_ATTRIBUTE } from './const';
import { useBrowserSidebarState } from './useBrowserSidebarState';
import { normalizeBrowserUrl } from './utils';

type WebviewElement = HTMLElement & { getWebContentsId: () => number };

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    width: 100%;
    min-height: 0;

    background: ${cssVar.colorBgLayout};
  `,
  toolbar: css`
    flex-shrink: 0;
    min-height: 56px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  address: css`
    position: absolute;
    inset-inline-start: 50%;
    transform: translateX(-50%);
    width: min(48%, 520px);

    input {
      text-align: center;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  importBanner: css`
    flex-shrink: 0;

    min-height: 72px;
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  importCopy: css`
    min-width: 0;
  `,
  toolbarActions: css`
    margin-inline-start: auto;
  `,
  webview: css`
    position: absolute;
    inset: 0;

    width: 100%;
    height: 100%;
    border: 0;
  `,
}));

interface BrowserPaneProps {
  sessionId: string;
}

const BrowserPane = memo<BrowserPaneProps>(({ sessionId }) => {
  const { t } = useTranslation('chat');
  // The webview always mounts on a constant about:blank; the real first
  // navigation is issued through the controller IPC once the guest is attached,
  // so user-typed text never reaches the src attribute (a DOM-XSS sink). Later
  // navigations go through the same IPC so the guest page doesn't remount.
  // `initialUrl === undefined` renders the empty state instead of a webview;
  // its value only seeds the address bar until the first state broadcast.
  const [initialUrl, setInitialUrl] = useState<string>();
  const pendingUrl = useRef<string>(undefined);
  const state = useBrowserSidebarState(sessionId, initialUrl);
  const [address, setAddress] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportBanner, setShowImportBanner] = useState(true);
  const browserRequest = useGlobalStore((s) => s.status.workingSidebarBrowserRequest);
  const consumedNonce = useRef<number>(undefined);
  const webviewRef = useRef<WebviewElement>(null);

  // will-attach-webview only sees standard attributes, so the main process
  // can't learn the sessionId there — bind it explicitly once the guest exists.
  // The pending first navigation rides on a successful attach.
  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;

    const handleDomReady = () => {
      const webContentsId = el.getWebContentsId();
      electronBrowserSidebarService
        .attach({ sessionId, webContentsId })
        .then((result) => {
          if (!result.success) return;
          const pending = pendingUrl.current;
          pendingUrl.current = undefined;
          if (pending) return electronBrowserSidebarService.navigate({ sessionId, url: pending });
        })
        .catch((error) => {
          console.error('[BrowserSidebar] Failed to attach webview:', error);
        });
    };

    el.addEventListener('dom-ready', handleDomReady);
    return () => el.removeEventListener('dom-ready', handleDomReady);
  }, [initialUrl, sessionId]);

  // The pane is keyed by session, so switching agents back remounts it with
  // empty local state while the main process still holds the session's page.
  // Bring the webview back on the recorded URL instead of an empty pane.
  useEffect(() => {
    if (initialUrl || !state.url || state.url === 'about:blank') return;
    pendingUrl.current = state.url;
    setInitialUrl(state.url);
  }, [initialUrl, state.url]);

  useEffect(() => {
    if (!isEditing) setAddress(state.url === 'about:blank' ? '' : state.url);
  }, [isEditing, state.url]);

  const runAction = async (action: () => Promise<{ error?: string; success: boolean }>) => {
    try {
      const result = await action();
      if (!result.success) {
        message.error(result.error || t('workingPanel.browser.actions.failed'));
      }
    } catch (error) {
      console.error('[BrowserSidebar] Browser action failed:', error);
      message.error(t('workingPanel.browser.actions.failed'));
    }
  };

  const openUrl = (rawUrl: string) => {
    const url = normalizeBrowserUrl(rawUrl);
    setAddress(url);

    if (!initialUrl) {
      pendingUrl.current = url;
      setInitialUrl(url);
      return;
    }

    void runAction(() => electronBrowserSidebarService.navigate({ sessionId, url }));
  };

  const handleImportChromeLoginData = async () => {
    setIsImporting(true);
    try {
      const result = await electronBrowserSidebarService.importChromeLoginData();
      if (!result.success) {
        message.error(t('workingPanel.browser.import.failed'));
        return;
      }

      message.success(t('workingPanel.browser.import.success', { count: result.importedCount }));
      setShowImportBanner(false);
      if (state.attached) {
        void runAction(() => electronBrowserSidebarService.reload({ sessionId }));
      }
    } catch (error) {
      console.error('[BrowserSidebar] Failed to import Chrome login information:', error);
      message.error(t('workingPanel.browser.import.failed'));
    } finally {
      setIsImporting(false);
    }
  };

  // External open requests (web-browsing search results, store action) arrive as
  // one-shot nonces; the pane may mount after the request was fired, so consume
  // whatever is pending on mount too.
  useEffect(() => {
    if (!browserRequest || consumedNonce.current === browserRequest.nonce) return;
    consumedNonce.current = browserRequest.nonce;
    openUrl(browserRequest.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserRequest?.nonce]);

  if (!isDesktop)
    return (
      <Center height={'100%'} width={'100%'}>
        <Empty description={t('workingPanel.browser.desktopOnly')} icon={Globe} />
      </Center>
    );

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <Flexbox horizontal align={'center'} className={styles.toolbar} gap={4}>
        <Flexbox horizontal align={'center'} gap={4}>
          <ActionIcon
            disabled={!state.canGoBack}
            icon={ChevronLeft}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.browser.actions.back')}
            onClick={() => runAction(() => electronBrowserSidebarService.goBack({ sessionId }))}
          />
          <ActionIcon
            disabled={!state.canGoForward}
            icon={ChevronRight}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.browser.actions.forward')}
            onClick={() => runAction(() => electronBrowserSidebarService.goForward({ sessionId }))}
          />
          <ActionIcon
            disabled={!state.attached}
            icon={state.isLoading ? XCircle : RefreshCw}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={
              state.isLoading
                ? t('workingPanel.browser.actions.stop')
                : t('workingPanel.browser.actions.reload')
            }
            onClick={() =>
              runAction(() =>
                state.isLoading
                  ? electronBrowserSidebarService.stop({ sessionId })
                  : electronBrowserSidebarService.reload({ sessionId }),
              )
            }
          />
        </Flexbox>
        <Input
          className={styles.address}
          placeholder={t('workingPanel.browser.addressPlaceholder')}
          size={'small'}
          value={address}
          variant={'borderless'}
          onBlur={() => setIsEditing(false)}
          onFocus={() => setIsEditing(true)}
          onChange={(event) => {
            setIsEditing(true);
            setAddress(event.target.value);
          }}
          onPressEnter={() => {
            setIsEditing(false);
            openUrl(address);
          }}
        />
        <Flexbox horizontal align={'center'} className={styles.toolbarActions} gap={4}>
          <ActionIcon
            disabled={!state.attached}
            icon={ExternalLink}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.browser.actions.openExternal')}
            onClick={() =>
              runAction(() => electronBrowserSidebarService.openExternal({ sessionId }))
            }
          />
          <ActionIcon
            disabled={!state.attached}
            icon={Camera}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.browser.actions.capture')}
            onClick={() =>
              runAction(async () => {
                const result = await electronBrowserSidebarService.captureScreenshotToClipboard({
                  sessionId,
                });
                if (result.success) message.success(t('workingPanel.browser.actions.captured'));
                return result;
              })
            }
          />
        </Flexbox>
      </Flexbox>
      {showImportBanner && (
        <Flexbox horizontal align={'center'} className={styles.importBanner} gap={12}>
          <BrowserIcon browser={'Chrome'} size={32} />
          <Flexbox className={styles.importCopy} gap={0}>
            <Text strong>{t('workingPanel.browser.import.title')}</Text>
            <Text ellipsis type={'secondary'}>
              {t('workingPanel.browser.import.desc')}
            </Text>
          </Flexbox>
          <Button
            icon={<Icon icon={Import} />}
            loading={isImporting}
            onClick={handleImportChromeLoginData}
          >
            {t('workingPanel.browser.import.action')}
          </Button>
          <ActionIcon
            icon={XCircle}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.browser.import.dismiss')}
            onClick={() => setShowImportBanner(false)}
          />
        </Flexbox>
      )}
      <Flexbox className={styles.container}>
        <AgentOverlay sessionId={sessionId} />
        {initialUrl ? (
          <webview
            className={styles.webview}
            key={sessionId}
            partition={BROWSER_WEBVIEW_PARTITION}
            ref={webviewRef}
            src={'about:blank'}
            {...{ [BROWSER_WEBVIEW_SESSION_ATTRIBUTE]: sessionId }}
          />
        ) : (
          <Center height={'100%'} width={'100%'}>
            <Empty
              description={t('workingPanel.browser.empty.desc')}
              icon={Globe}
              title={t('workingPanel.browser.empty.title')}
            />
          </Center>
        )}
      </Flexbox>
    </Flexbox>
  );
});

BrowserPane.displayName = 'BrowserPane';

export default BrowserPane;
