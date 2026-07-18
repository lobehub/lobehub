import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { PanelRightCloseIcon } from 'lucide-react';
import { lazy, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessWorkingSidebarTabs } from '@/business/client/features/WorkingSidebarTabs';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { isDesktop } from '@/const/version';
import { useRepoType } from '@/features/ChatInput/ControlBar/useRepoType';
import RightPanel from '@/features/RightPanel';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

import Files from './Files';
import ProgressSection from './ProgressSection';
import ResourcesSection from './ResourcesSection';
import Review from './Review';
import WorksSection from './WorksSection';

const ParamsSection = lazy(() => import('./ParamsSection'));
const BrowserPane = lazy(() => import('./Browser'));

const styles = createStaticStyles(({ css, cssVar }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  header: css`
    flex-shrink: 0;
  `,
  pane: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  paneHidden: css`
    display: none;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: none;
    border-radius: 6px;

    font-size: 13px;
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    transition:
      color 0.15s,
      background 0.15s;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillTertiary};
  `,
  tabs: css`
    display: flex;
    gap: 4px;
    align-items: center;
  `,
}));

const REVIEW_TREE_STORAGE_KEY = 'lobechat-review-tree';
const MAX_PANEL_WIDTH = 1200;
// Two-pane Review (diff list + file-tree rail) is cramped below this.
const TWO_PANE_MIN_WIDTH = 560;

const AgentWorkingSidebar = memo(() => {
  const { t } = useTranslation(['chat', 'setting']);
  const [
    storedWidth,
    updateSystemStatus,
    toggleRightPanel,
    setWorkingSidebarTab,
    showRightPanel,
    storedTab,
  ] = useGlobalStore((s) => [
    systemStatusSelectors.workingSidebarWidth(s),
    s.updateSystemStatus,
    s.toggleRightPanel,
    s.setWorkingSidebarTab,
    // Panel open/collapsed state (drives the `<RightPanel>` expand). Used to gate
    // the resources pane's document fetch so a collapsed sidebar doesn't pull the
    // full agent-document list into the conversation's initial batch.
    s.status.showRightPanel,
    s.status.workingSidebarTab,
  ]);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const topicId = useChatStore((s) => s.activeTopicId);
  const isChatMode = useAgentStore((s) =>
    activeAgentId ? chatConfigByIdSelectors.isChatModeById(activeAgentId)(s) : false,
  );
  const isHetero = useAgentStore(agentSelectors.isCurrentAgentHeterogeneous);
  // Unified precedence (topic > per-device choice > legacy > device default), so
  // the sidebar resolves the same directory the runtime bar / git status do.
  // The old `topicCwd || legacy agentCwd` pattern missed `workingDirByDevice`,
  // landing on the home fallback for device-bound agents and hiding Review.
  const workingDirectory = useEffectiveWorkingDirectory(activeAgentId);
  // Effective target device for git ops — bound device for remote agents, this
  // machine otherwise. Resolved the same way WorkingDirectoryPicker / GitStatus do.
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(activeAgentId);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const targetDeviceId = resolveTargetDeviceId(agencyConfig, currentDeviceId, {
    workspaceScoped,
  });
  const repoType = useRepoType(workingDirectory, targetDeviceId);
  const deviceRoutingAvailable = useIsGatewayModeEnabled(activeAgentId);
  const effectiveTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });

  // Running against a bound device (remote, or this machine as a device): file
  // tree + git reads go over RPC, so both Review and Files are reachable even
  // when runtimeMode isn't `local`.
  const isDeviceMode = effectiveTarget === 'device' && !!agencyConfig?.boundDeviceId;
  // `targetDeviceId` also identifies the local desktop for per-device working
  // directory state. Files/Review only need a deviceId when routing through a
  // remote device RPC; local "This device" must keep Electron IPC + file-open
  // actions enabled.
  const remoteDeviceId = isDeviceMode ? agencyConfig.boundDeviceId : undefined;
  const isLocalExecution = effectiveTarget === 'local';
  // Files tab is an agent-mode affordance — in plain chat mode the working
  // directory is irrelevant to the user, so hide the tab even when one resolves.
  const filesAvailable = !isChatMode && (isLocalExecution || isDeviceMode) && !!workingDirectory;
  const reviewAvailable = (isLocalExecution || isDeviceMode) && !!workingDirectory && !!repoType;
  const paramsAvailable = !isHetero;
  // The in-app browser pages are main-process WebContentsViews — desktop only,
  // and gated behind the Labs toggle while the feature matures.
  const enableInAppBrowser = useUserStore(labPreferSelectors.enableInAppBrowser);
  const browserAvailable = isDesktop && enableInAppBrowser;
  // Must mint the same key the browser tools do (`sessionIdOf` in
  // builtin-tool-browser), or the user and the agent would be looking at two
  // different pages. A draft topic has no id yet, but the panel is openable
  // there (user types a URL before sending anything), so it borrows a per-agent
  // key until the topic materializes.
  const browserSessionId = topicId
    ? `topic:${topicId}`
    : `draft-agent:${activeAgentId ?? 'default'}`;

  const businessTabs = useBusinessWorkingSidebarTabs({ activeAgentId, topicId });

  const availableTabs = new Set<string>([
    'resources',
    'works',
    ...(reviewAvailable ? ['review'] : []),
    ...(filesAvailable ? ['files'] : []),
    ...(browserAvailable ? ['browser'] : []),
    ...(paramsAvailable ? ['params'] : []),
    ...businessTabs.map((tab) => tab.key),
  ]);

  const resolveActiveTab = (): string => {
    if (storedTab && availableTabs.has(storedTab)) return storedTab;
    // a persisted tab may reference a business tab that is absent in this build
    if (storedTab) {
      if (paramsAvailable) return 'params';
      if (reviewAvailable) return 'review';
      if (filesAvailable) return 'files';
      return 'resources';
    }
    if (isHetero) return 'resources';
    if (reviewAvailable) return 'review';
    if (filesAvailable) return 'files';
    return 'resources';
  };
  const activeTab = resolveActiveTab();

  // Review's tree-nav rail lives here (not inside Review) so the panel can widen
  // when the two-pane layout is on. Hidden by default — the panel shows only the
  // diff list until the user opens the tree from the toolbar. Persisted so it
  // survives reloads.
  const [showReviewTree, setShowReviewTree] = useLocalStorageState<boolean>(
    REVIEW_TREE_STORAGE_KEY,
    false,
  );
  // Mount the browser pane on first activation only (no eager page load), then
  // keep it mounted-but-hidden so the page survives tab switches.
  const [browserActivated, setBrowserActivated] = useState(false);
  useEffect(() => {
    if (activeTab === 'browser') setBrowserActivated(true);
  }, [activeTab]);
  const reviewTwoPane = activeTab === 'review' && reviewAvailable && showReviewTree;
  const displayWidth = reviewTwoPane ? Math.max(storedWidth, TWO_PANE_MIN_WIDTH) : storedWidth;

  return (
    <RightPanel
      stableLayout
      defaultWidth={displayWidth}
      maxWidth={MAX_PANEL_WIDTH}
      minWidth={300}
      width={displayWidth}
      onSizeChange={(size) => {
        if (!size?.width) return;
        // DraggablePanel emits width as a `"420px"` string on drag-stop; parse it so
        // the controlled width actually updates (otherwise the panel snaps back).
        const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
        if (!Number.isFinite(w) || w === storedWidth) return;
        updateSystemStatus({ workingSidebarWidth: w });
      }}
    >
      <Flexbox height={'100%'} width={'100%'}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.header}
          height={44}
          justify={'space-between'}
          paddingInline={4}
        >
          <div className={styles.tabs}>
            {businessTabs.map((tab) => (
              <button
                className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
                key={tab.key}
                type="button"
                onClick={() => setWorkingSidebarTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
            <button
              className={`${styles.tab} ${activeTab === 'resources' ? styles.tabActive : ''}`}
              type="button"
              onClick={() => setWorkingSidebarTab('resources')}
            >
              {t('workingPanel.space')}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'works' ? styles.tabActive : ''}`}
              type="button"
              onClick={() => setWorkingSidebarTab('works')}
            >
              {t('workingPanel.works.title')}
            </button>
            {reviewAvailable && (
              <button
                className={`${styles.tab} ${activeTab === 'review' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setWorkingSidebarTab('review')}
              >
                {t('workingPanel.review.title')}
              </button>
            )}
            {filesAvailable && (
              <button
                className={`${styles.tab} ${activeTab === 'files' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setWorkingSidebarTab('files')}
              >
                {t('workingPanel.files.title')}
              </button>
            )}
            {browserAvailable && (
              <button
                className={`${styles.tab} ${activeTab === 'browser' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setWorkingSidebarTab('browser')}
              >
                {t('workingPanel.browser.title')}
              </button>
            )}
            {paramsAvailable && (
              <button
                className={`${styles.tab} ${activeTab === 'params' ? styles.tabActive : ''}`}
                type="button"
                onClick={() => setWorkingSidebarTab('params')}
              >
                {t('settingModel.params.panel.tab', { ns: 'setting' })}
              </button>
            )}
          </div>
          <ActionIcon
            icon={PanelRightCloseIcon}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            onClick={() => toggleRightPanel(false)}
          />
        </Flexbox>
        <Flexbox className={styles.body} width={'100%'}>
          {paramsAvailable && activeTab === 'params' && (
            <Flexbox className={styles.pane}>
              <ParamsSection />
            </Flexbox>
          )}
          {reviewAvailable && (
            <Flexbox className={activeTab === 'review' ? styles.pane : styles.paneHidden}>
              <Review
                active={activeTab === 'review'}
                deviceId={remoteDeviceId}
                showTree={showReviewTree}
                workingDirectory={workingDirectory}
                onToggleTree={() => setShowReviewTree((v) => !v)}
              />
            </Flexbox>
          )}
          {filesAvailable && (
            <Flexbox className={activeTab === 'files' ? styles.pane : styles.paneHidden}>
              <Files deviceId={remoteDeviceId} workingDirectory={workingDirectory} />
            </Flexbox>
          )}
          {browserAvailable && browserActivated && (
            <Flexbox className={activeTab === 'browser' ? styles.pane : styles.paneHidden}>
              {/* Keyed by session: the pane holds per-session local state (webview,
              address bar), so an agent switch must remount it rather than leak the
              previous agent's page into the new agent's session. */}
              <BrowserPane key={browserSessionId} sessionId={browserSessionId} />
            </Flexbox>
          )}
          {businessTabs.map((tab) => (
            <Flexbox
              className={activeTab === tab.key ? styles.pane : styles.paneHidden}
              key={tab.key}
            >
              {tab.pane}
            </Flexbox>
          ))}
          <Flexbox
            className={activeTab === 'resources' ? styles.pane : styles.paneHidden}
            gap={8}
            width={'100%'}
          >
            <ProgressSection />
            <ResourcesSection
              deviceId={remoteDeviceId}
              enabled={showRightPanel && activeTab === 'resources'}
            />
          </Flexbox>
          <Flexbox className={activeTab === 'works' ? styles.pane : styles.paneHidden}>
            <WorksSection active={showRightPanel && activeTab === 'works'} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    </RightPanel>
  );
});

export default AgentWorkingSidebar;
