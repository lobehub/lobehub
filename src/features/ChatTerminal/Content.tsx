'use client';

import { isDesktop } from '@lobechat/const';
import { createStaticStyles, Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  type ContextMenuItem,
  ContextMenuTrigger,
  Select,
  TabsIndicator,
  TabsList,
  TabsRoot,
  TabsTab,
  Text,
} from '@lobehub/ui';
import {
  CopyXIcon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  SquareTerminalIcon,
  XIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { canHostTerminal, deviceSelectors, useDeviceStore } from '@/store/device';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

import SplitView from './SplitView';
import type { TerminalTab } from './store';
import { useChatTerminalStore } from './store';

const EMPTY_TABS: TerminalTab[] = [];

/** Sentinel for "run on this machine"; device ids are never empty strings. */
const LOCAL_TARGET = '';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    height: 100%;
    background: ${cssVar.colorBgContainer};
  `,
  indicator: css`
    && {
      border-radius: ${cssVar.borderRadius};
      background: ${cssVar.colorFillSecondary};
      box-shadow: none;
    }
  `,
  tab: css`
    && {
      gap: 4px;
      height: 24px;
      padding-inline: 8px 4px;
      font-weight: normal;
    }

    &&[data-active] {
      color: ${cssVar.colorText};
    }
  `,
  tabBar: css`
    flex: none;
    padding-block: 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  tabList: css`
    && {
      gap: 4px;
      padding: 0;
      border-radius: 0;
      background: none;
    }
  `,
  tabs: css`
    width: auto;
  `,
  view: css`
    overflow: hidden;
    flex: 1;

    min-height: 0;
    padding-block: 4px 8px;
    padding-inline: 12px;
  `,
}));

const Content = memo(() => {
  const { t } = useTranslation('chat');

  const topicId = useChatStore((s) => s.activeTopicId);
  const agentId = useChatStore((s) => s.activeAgentId);
  const topicWorkingDirectory = useChatStore(topicSelectors.currentTopicWorkingDirectory);
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const agentWorkingDirectory = useAgentStore((s) =>
    agentId
      ? agentByIdSelectors.getAgentWorkingDirectoryById(agentId, currentDeviceId)(s)
      : undefined,
  );
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);

  // Tabs are bound to the topic: sessions created here only show for this topic.
  const topicKey = topicId || (agentId ? `agent:${agentId}` : 'global');
  const cwd = topicWorkingDirectory || agentWorkingDirectory || undefined;

  const tabs = useChatTerminalStore((s) => s.tabsByTopic[topicKey]) ?? EMPTY_TABS;
  const activeTabId = useChatTerminalStore((s) => s.activeTabIds[topicKey]);
  const creating = useChatTerminalStore((s) => !!s.creatingByTopic[topicKey]);
  const createError = useChatTerminalStore((s) => s.createErrors[topicKey]);
  const createTab = useChatTerminalStore((s) => s.createTab);
  const closeTab = useChatTerminalStore((s) => s.closeTab);
  const closeOtherTabs = useChatTerminalStore((s) => s.closeOtherTabs);
  const setActiveTab = useChatTerminalStore((s) => s.setActiveTab);
  const splitPane = useChatTerminalStore((s) => s.splitPane);
  const closePane = useChatTerminalStore((s) => s.closePane);
  const setActivePane = useChatTerminalStore((s) => s.setActivePane);
  const setPaneFlex = useChatTerminalStore((s) => s.setPaneFlex);
  const targetDeviceId = useChatTerminalStore((s) => s.deviceByTopic[topicKey]);
  const setTerminalDevice = useChatTerminalStore((s) => s.setTerminalDevice);

  const devices = useDeviceStore(deviceSelectors.deviceList);
  // Only devices that can actually open a shell. An offline row, or one whose
  // live connections are all desktop ones, answers a terminal RPC with a
  // refusal — offering it would fail the session the moment it is claimed.
  const targets = useMemo(() => devices.filter(canHostTerminal), [devices]);
  // Desktop can always run a shell here; the web build needs a device.
  const canSpawn = isDesktop || !!targetDeviceId;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(-1);

  const prevTabCountRef = useRef(0);

  // The web build has no local shell, so a topic must name a device before the
  // first terminal can open. Claim the first usable one until the user picks
  // another.
  useEffect(() => {
    if (isDesktop || targetDeviceId || targets.length === 0) return;
    setTerminalDevice(topicKey, targets[0].deviceId);
  }, [targets, setTerminalDevice, targetDeviceId, topicKey]);

  // Open a first shell automatically when this topic has none yet and we know
  // where it would run. Runs on open / topic switch / target arrival only — NOT
  // on tab-count changes, so closing the last tab doesn't respawn a shell.
  useEffect(() => {
    prevTabCountRef.current = tabs.length;
    if (tabs.length === 0 && canSpawn) void createTab(topicKey, cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey, canSpawn]);

  // Closing the last tab (X button or the shell exiting) collapses the panel.
  useEffect(() => {
    if (tabs.length === 0 && prevTabCountRef.current > 0) toggleTerminalPanel(false);
    prevTabCountRef.current = tabs.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  const tabMenuItems = (tabId: string): ContextMenuItem[] => [
    {
      icon: XIcon,
      key: 'close',
      label: t('terminalPanel.closeTab'),
      onClick: () => closeTab(topicKey, tabId),
    },
    {
      disabled: tabs.length <= 1,
      icon: CopyXIcon,
      key: 'closeOthers',
      label: t('terminalPanel.closeOtherTabs'),
      onClick: () => closeOtherTabs(topicKey, tabId),
    },
  ];

  /**
   * Point the topic at another machine. Existing shells keep running where they
   * started, so open one — otherwise picking a device looks like it did nothing.
   */
  const selectTarget = (next: string) => {
    setTerminalDevice(topicKey, next === LOCAL_TARGET ? undefined : next);
    void createTab(topicKey, cwd);
  };

  const targetOptions = [
    ...(isDesktop ? [{ label: t('terminalPanel.targetLocal'), value: LOCAL_TARGET }] : []),
    ...targets.map((device) => ({
      label: device.friendlyName || device.hostname || device.deviceId,
      value: device.deviceId,
    })),
  ];

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.tabBar} gap={4}>
        <TabsRoot
          className={styles.tabs}
          size={'small'}
          value={activeTab?.id ?? null}
          onValueChange={(next) => {
            if (typeof next === 'string') setActiveTab(topicKey, next);
          }}
        >
          <TabsList className={styles.tabList}>
            <TabsIndicator className={styles.indicator} />
            {tabs.map((tab) => (
              <ContextMenuTrigger items={() => tabMenuItems(tab.id)} key={tab.id}>
                <TabsTab className={styles.tab} value={tab.id}>
                  <SquareTerminalIcon size={12} />
                  {tab.title}
                  <ActionIcon
                    icon={XIcon}
                    size={{ blockSize: 20, size: 12 }}
                    title={t('terminalPanel.closeTab')}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(topicKey, tab.id);
                    }}
                  />
                </TabsTab>
              </ContextMenuTrigger>
            ))}
          </TabsList>
        </TabsRoot>
        <ActionIcon
          icon={PlusIcon}
          loading={creating}
          size={'small'}
          title={t('terminalPanel.newTab')}
          onClick={() => createTab(topicKey, cwd)}
        />
        <Select
          options={targetOptions}
          size={'small'}
          style={{ minWidth: 120 }}
          value={targetDeviceId ?? LOCAL_TARGET}
          onChange={(value) => selectTarget(String(value))}
        />
        <Flexbox flex={1} />
        <ActionIcon
          disabled={!activeTab || creating}
          icon={SquareSplitHorizontalIcon}
          size={'small'}
          title={t('terminalPanel.split')}
          onClick={() => activeTab && splitPane(topicKey, activeTab.id, cwd)}
        />
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('terminalPanel.close')}
          onClick={() => toggleTerminalPanel(false)}
        />
      </Flexbox>
      <div className={styles.view}>
        {activeTab ? (
          <SplitView
            activePaneId={activeTab.activePaneId}
            panes={activeTab.panes}
            onActivatePane={(paneId) => setActivePane(topicKey, activeTab.id, paneId)}
            onClosePane={(paneId) => closePane(topicKey, paneId)}
            onResize={(flex) => setPaneFlex(topicKey, activeTab.id, flex)}
          />
        ) : createError ? (
          <Flexbox align={'center'} flex={1} gap={8} height={'100%'} justify={'center'}>
            <Text type={'secondary'}>{t('terminalPanel.createFailed')}</Text>
            <Button size={'small'} onClick={() => createTab(topicKey, cwd)}>
              {t('retry', { ns: 'common' })}
            </Button>
          </Flexbox>
        ) : null}
      </div>
    </Flexbox>
  );
});

export default Content;
