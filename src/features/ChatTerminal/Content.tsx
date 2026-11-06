'use client';

import { isDesktop } from '@lobechat/const';
import {
  ActionIcon,
  Button,
  type ContextMenuItem,
  ContextMenuTrigger,
  Flexbox,
  Select,
  TabsIndicator,
  TabsList,
  TabsRoot,
  TabsTab,
  Text,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CopyXIcon,
  PlusIcon,
  SquareSplitHorizontalIcon,
  SquareTerminalIcon,
  XIcon,
} from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';

import SplitView from './SplitView';
import type { TerminalTab } from './store';
import { useChatTerminalStore } from './store';
import { buildTargetOptions, LOCAL_TARGET } from './targetOptions';
import { useTerminalTarget } from './useTerminalTarget';

const EMPTY_TABS: TerminalTab[] = [];

const styles = stylex.create({
  container: {
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
    height: '100%',
    overflow: 'hidden',
  },
  indicator: {
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
    borderRadius: cssVar.borderRadius,
    boxShadow: 'none',
  },
  tab: {
    color: { 'default': null, '[data-active]': cssVar.colorText },
    fontWeight: 'normal',
    gap: '4px',
    height: '24px',
    paddingInlineEnd: '4px',
    paddingInlineStart: '8px',
  },
  tabBar: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: '1px',
    flex: 'none',
    paddingBlock: '4px',
    paddingInline: '8px',
  },
  tabList: {
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    borderRadius: 0,
    gap: '4px',
    padding: 0,
  },
  tabs: {
    width: 'auto',
  },
  view: {
    flex: '1',
    minHeight: 0,
    overflow: 'hidden',
    paddingBlockEnd: '8px',
    paddingBlockStart: '4px',
    paddingInline: '12px',
  },
});

const Content = memo(() => {
  const { t } = useTranslation('chat');

  const topicId = useChatStore((s) => s.activeTopicId);
  const agentId = useChatStore((s) => s.activeAgentId);
  const toggleTerminalPanel = useGlobalStore((s) => s.toggleTerminalPanel);

  // Tabs are bound to the topic: sessions created here only show for this topic.
  const topicKey = topicId || (agentId ? `agent:${agentId}` : 'global');

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

  const { canSpawn, cwd, selectTarget, targetDeviceId, targets } = useTerminalTarget(
    topicKey,
    agentId || undefined,
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(-1);

  const prevTabCountRef = useRef(0);

  // Open a first shell automatically when this topic has none yet and we know
  // where it would run. Runs on open / topic switch / target arrival only — NOT
  // on tab-count changes, so closing the last tab doesn't respawn a shell.
  useEffect(() => {
    prevTabCountRef.current = tabs.length;
    if (tabs.length === 0 && canSpawn) void createTab(topicKey, cwd, targetDeviceId);
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

  const targetOptions = buildTargetOptions(
    targets,
    isDesktop ? t('terminalPanel.targetLocal') : undefined,
  );

  return (
    <Flexbox className={stylex.props(styles.container).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.tabBar).className}
        gap={4}
      >
        <TabsRoot
          className={stylex.props(styles.tabs).className}
          size={'small'}
          value={activeTab?.id ?? null}
          onValueChange={(next) => {
            if (typeof next === 'string') setActiveTab(topicKey, next);
          }}
        >
          <TabsList className={stylex.props(styles.tabList).className}>
            <TabsIndicator className={stylex.props(styles.indicator).className} />
            {tabs.map((tab) => (
              <ContextMenuTrigger items={() => tabMenuItems(tab.id)} key={tab.id}>
                <TabsTab className={stylex.props(styles.tab).className} value={tab.id}>
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
          onClick={() => createTab(topicKey, cwd, targetDeviceId)}
        />
        <Flexbox flex={1} />
        <Select
          options={targetOptions}
          size={'small'}
          // The trigger defaults to `width: 100%`, which fills the whole tab bar.
          style={{ flex: 'none', maxWidth: 240, minWidth: 120, width: 'auto' }}
          value={targetDeviceId ?? LOCAL_TARGET}
          onChange={(value) => selectTarget(String(value))}
        />
        <ActionIcon
          disabled={!activeTab || creating}
          icon={SquareSplitHorizontalIcon}
          size={'small'}
          title={t('terminalPanel.split')}
          onClick={() => activeTab && splitPane(topicKey, activeTab.id, cwd, targetDeviceId)}
        />
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('terminalPanel.close')}
          onClick={() => toggleTerminalPanel(false)}
        />
      </Flexbox>
      <div {...stylex.props(styles.view)}>
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
            <Button onClick={() => createTab(topicKey, cwd, targetDeviceId)}>
              {t('retry', { ns: 'common' })}
            </Button>
          </Flexbox>
        ) : null}
      </div>
    </Flexbox>
  );
});

export default Content;
