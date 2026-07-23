'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import {
  Button,
  type ContextMenuItem,
  ContextMenuTrigger,
  TabsIndicator,
  TabsList,
  TabsRoot,
  TabsTab,
} from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CopyXIcon, PlusIcon, SquareTerminalIcon, XIcon } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { useElectronStore } from '@/store/electron';
import { useGlobalStore } from '@/store/global';

import type { TerminalTab } from './store';
import { useChatTerminalStore } from './store';
import TerminalView from './TerminalView';

const EMPTY_TABS: TerminalTab[] = [];

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

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(-1);

  const prevTabCountRef = useRef(0);

  // Open a first shell automatically when this topic has none yet. Runs on
  // open / topic switch only — NOT on tab-count changes, so closing the last
  // tab doesn't immediately respawn a shell.
  useEffect(() => {
    prevTabCountRef.current = tabs.length;
    if (tabs.length === 0) void createTab(topicKey, cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicKey]);

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
        <Flexbox flex={1} />
        <ActionIcon
          icon={XIcon}
          size={'small'}
          title={t('terminalPanel.close')}
          onClick={() => toggleTerminalPanel(false)}
        />
      </Flexbox>
      <div className={styles.view}>
        {activeTab ? (
          <TerminalView sessionId={activeTab.id} />
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
