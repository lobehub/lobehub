import { isDesktop } from '@lobechat/const';
import { nanoid } from '@lobechat/utils';
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
  SquareDashedMousePointer,
  XCircle,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { BrowserIcon } from '@/components/BrowserIcon';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { electronBrowserSidebarService } from '@/services/electron/browserSidebar';
import { useChatStore } from '@/store/chat';
import { useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';

import { BROWSER_IMPORT_BANNER_DISMISSED_STORAGE_KEY } from './const';
import { useBrowserSidebarState } from './useBrowserSidebarState';
import {
  buildScreenshotFileName,
  createElementContext,
  dataUrlToFile,
  getBrowserViewportRect,
  normalizeBrowserUrl,
} from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  loadingBar: css`
    pointer-events: none;

    position: absolute;
    z-index: 3;

    /* Anchored to the toolbar's bottom border — the page container below is
       covered by the WebContentsView, which paints above renderer DOM. */
    inset-block-end: -1px;
    inset-inline: 0;

    overflow: hidden;

    height: 2px;

    &::after {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;

      width: 36%;

      background: ${cssVar.colorInfo};

      animation: browser-loading-progress 1.15s ease-in-out infinite;
    }

    @keyframes browser-loading-progress {
      from {
        transform: translateX(-110%);
      }

      to {
        transform: translateX(310%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      &::after {
        width: 100%;
        animation: none;
      }
    }
  `,
  container: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    width: 100%;
    min-height: 0;

    background: ${cssVar.colorBgContainer};
  `,
  toolbar: css`
    position: relative;

    flex-shrink: 0;

    min-height: 56px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  address: css`
    flex: 1;
    min-width: 0;
    max-width: 720px;

    /* The filled variant keeps its tinted fill while focused; lift it to the
       container surface so the focus ring reads as an editable field. Doubling
       the class outranks antd's own :focus rule. */
    &&:focus {
      background: ${cssVar.colorBgContainer};
    }
  `,
  importBanner: css`
    container-type: inline-size;
    flex-shrink: 0;
    flex-wrap: wrap;

    min-height: 72px;
    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  importCopy: css`
    flex: 1;
    min-width: 0;
  `,
  importActions: css`
    margin-inline-start: auto;

    @container (max-width: 480px) {
      flex-basis: 100%;
      justify-content: flex-end;
      margin-inline-start: 44px;
    }
  `,
  toolbarActions: css`
    margin-inline-start: auto;
  `,
  /* The page itself is a main-process WebContentsView laid over this element —
     nothing renders inside it. It exists to be measured. */
  viewport: css`
    position: absolute;
    inset: 0;
  `,
}));

interface BrowserPaneProps {
  /** The conversation the chat input belongs to — screenshots are attached there. */
  agentId?: string;
  onMetadataChange?: (metadata: { faviconUrl?: string; title: string; url: string }) => void;
  sessionId: string;
}

const BrowserPane = memo<BrowserPaneProps>(({ agentId, onMetadataChange, sessionId }) => {
  const { t } = useTranslation('chat');
  const state = useBrowserSidebarState(sessionId);
  const [address, setAddress] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isImportBannerDismissed, setIsImportBannerDismissed] = useLocalStorageState(
    BROWSER_IMPORT_BANNER_DISMISSED_STORAGE_KEY,
    false,
  );
  const browserRequest = useGlobalStore((s) => s.status.workingSidebarBrowserRequest);
  const clearBrowserTabRequest = useGlobalStore((s) => s.clearBrowserTabRequest);
  const consumedNonce = useRef<number>(undefined);
  const viewportRef = useRef<HTMLDivElement>(null);

  // The page lives in the main process, so it exists as soon as anything has
  // navigated it — including an agent the user has never watched.
  const hasPage = state.attached || (!!state.url && state.url !== 'about:blank');

  useEffect(() => {
    onMetadataChange?.({ faviconUrl: state.faviconUrl, title: state.title, url: state.url });
  }, [onMetadataChange, state.faviconUrl, state.title, state.url]);

  // The overlay is drawn inside the page (a WebContentsView paints above all
  // renderer DOM, so it can't be drawn here any more) — hand the copy over.
  useEffect(() => {
    if (!isDesktop) return;
    void electronBrowserSidebarService.setOverlayLabels({
      controlling: t('workingPanel.browser.agentControlling'),
      cursor: t('workingPanel.browser.agentCursor'),
    });
  }, [t]);

  // Tell the main process where to lay the page out. Polled rather than observed
  // because the panel also moves when nothing about it resizes (the left sidebar
  // collapsing shifts its x), and a ResizeObserver would sleep through that.
  // A zero-sized rect — which is what `display: none` reports when another tab is
  // active — parks the page off-screen instead of destroying it.
  useEffect(() => {
    if (!isDesktop || !hasPage) return;

    let frame = 0;
    let lastKey = '';

    const tick = () => {
      const element = viewportRef.current;
      if (element) {
        const rect = getBrowserViewportRect(element.getBoundingClientRect());
        const visible = rect.width >= 1 && rect.height >= 1;
        // devicePixelRatio tracks the app zoom level, and the main process turns
        // this CSS rect into DIP with the zoom factor. Without it in the key, a
        // Cmd +/- that leaves the rect unchanged would strand the page at the
        // bounds it had at the old zoom.
        const key = visible
          ? [rect.x, rect.y, rect.width, rect.height, window.devicePixelRatio]
              .map((value) => Math.round(value * 100))
              .join(',')
          : 'parked';

        if (key !== lastKey) {
          lastKey = key;
          void electronBrowserSidebarService.setViewport({
            rect: visible
              ? { height: rect.height, width: rect.width, x: rect.x, y: rect.y }
              : undefined,
            sessionId,
          });
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    // Nothing here handles "the same agent is open in another window, which took
    // the page": the rect never changes, so this loop stays silent. The main
    // process reclaims the page on the window's own `focus` event — a renderer
    // `focus` listener does not fire when you switch between two windows of the
    // same app (measured), so it cannot be the trigger.

    return () => {
      cancelAnimationFrame(frame);
      // Park rather than close: the agent may still be driving this page.
      void electronBrowserSidebarService.setViewport({ sessionId });
    };
  }, [hasPage, sessionId]);

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
    void runAction(() => electronBrowserSidebarService.navigate({ sessionId, url }));
  };

  const focusChatInput = () => {
    window.setTimeout(() => useChatStore.getState().mainInputEditor?.focus(), 160);
  };

  const addScreenshotToInput = async () => {
    if (isCapturing || !agentId) return;
    setIsCapturing(true);
    try {
      const result = await electronBrowserSidebarService.captureScreenshot({ sessionId });
      if (!result.success || !result.dataUrl) {
        message.error(result.error || t('workingPanel.browser.actions.failed'));
        return;
      }

      const file = dataUrlToFile(result.dataUrl, buildScreenshotFileName(result.title));
      // The attachment appears in the input immediately (pending state); the
      // upload itself reports its own progress and errors.
      void useFileStore.getState().uploadChatFiles([file], agentId);
      message.success(t('workingPanel.browser.actions.captured'));
      focusChatInput();
    } catch (error) {
      console.error('[BrowserSidebar] Failed to capture screenshot:', error);
      message.error(t('workingPanel.browser.actions.failed'));
    } finally {
      setIsCapturing(false);
    }
  };

  const pickElementContext = async () => {
    setIsPicking(true);
    try {
      const result = await electronBrowserSidebarService.pickElement({
        hint: t('workingPanel.browser.context.pickHint'),
        sessionId,
      });
      if (!result.success) {
        message.error(result.error || t('workingPanel.browser.context.failed'));
        return;
      }
      if (result.cancelled || !result.element) return;

      useFileStore.getState().addChatContextSelection(
        createElementContext({
          element: result.element,
          elementTitle: t('workingPanel.browser.context.elementTitle'),
          id: `browser-element-${nanoid(6)}`,
        }),
      );
      message.success(t('workingPanel.browser.context.elementAdded'));
      focusChatInput();
    } catch (error) {
      console.error('[BrowserSidebar] Failed to pick element:', error);
      message.error(t('workingPanel.browser.context.failed'));
    } finally {
      setIsPicking(false);
    }
  };

  // A pick left running when the pane unmounts (topic switch, tab change) would
  // leave the page swallowing every click — tear it down with the pane.
  useEffect(() => {
    if (!isDesktop) return;
    return () => {
      void electronBrowserSidebarService.cancelElementPick({ sessionId }).catch(() => {});
    };
  }, [sessionId]);

  const handleImportChromeLoginData = async () => {
    setIsImporting(true);
    try {
      const result = await electronBrowserSidebarService.importChromeLoginData();
      if (!result.success) {
        message.error(t('workingPanel.browser.import.failed'));
        return;
      }

      message.success(t('workingPanel.browser.import.success', { count: result.importedCount }));
      setIsImportBannerDismissed(true);
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
  //
  // Retiring the request in the store is what makes it truly one-shot. The nonce
  // ref alone cannot: it dies with the component, and the pane is remounted on
  // every topic switch (the browser session key is per-topic). A request left in
  // persisted status would then be re-consumed on each switch and would navigate
  // that topic's page away from whatever the agent had loaded there.
  useEffect(() => {
    if (!browserRequest || consumedNonce.current === browserRequest.nonce) return;
    consumedNonce.current = browserRequest.nonce;
    openUrl(browserRequest.url);
    clearBrowserTabRequest();
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
          value={address}
          variant={'filled'}
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
          {isPicking ? (
            <ActionIcon
              active
              icon={SquareDashedMousePointer}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('workingPanel.browser.context.pickCancel')}
              onClick={() =>
                void electronBrowserSidebarService.cancelElementPick({ sessionId }).catch(() => {})
              }
            />
          ) : (
            <ActionIcon
              disabled={!state.attached || state.isLoading}
              icon={SquareDashedMousePointer}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('workingPanel.browser.context.pickElement')}
              onClick={() => void pickElementContext()}
            />
          )}
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
            disabled={!state.attached || !agentId}
            icon={Camera}
            loading={isCapturing}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('workingPanel.browser.actions.capture')}
            onClick={() => void addScreenshotToInput()}
          />
        </Flexbox>
        {/* Sits on the toolbar's edge, not inside the page container: a
            WebContentsView paints above all renderer DOM, so a bar drawn over the
            page area would be hidden the moment a page is showing. */}
        {state.isLoading && (
          <div
            aria-label={t('workingPanel.browser.loading')}
            aria-valuetext={t('workingPanel.browser.loading')}
            className={styles.loadingBar}
            role="progressbar"
          />
        )}
      </Flexbox>
      {!isImportBannerDismissed && (
        <Flexbox horizontal align={'center'} className={styles.importBanner} gap={12}>
          <BrowserIcon browser={'Chrome'} size={32} />
          <Flexbox className={styles.importCopy} gap={0}>
            <Text strong>{t('workingPanel.browser.import.title')}</Text>
            <Text ellipsis type={'secondary'}>
              {t('workingPanel.browser.import.desc')}
            </Text>
          </Flexbox>
          <Flexbox horizontal align={'center'} className={styles.importActions} gap={4}>
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
              onClick={() => setIsImportBannerDismissed(true)}
            />
          </Flexbox>
        </Flexbox>
      )}
      <Flexbox className={styles.container}>
        {hasPage ? (
          <div className={styles.viewport} ref={viewportRef} />
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
