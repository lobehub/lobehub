'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { PlusIcon, SquareTerminalIcon, XIcon } from 'lucide-react';
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
  tab: css`
    cursor: pointer;

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px 2px;
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  tabActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  tabBar: css`
    flex: none;
    padding-block: 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
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

  return (
    <Flexbox className={styles.container}>
      <Flexbox horizontal align={'center'} className={styles.tabBar} gap={4}>
        {tabs.map((tab) => (
          <div
            className={cx(styles.tab, tab.id === activeTab?.id && styles.tabActive)}
            key={tab.id}
            onClick={() => setActiveTab(topicKey, tab.id)}
          >
            <SquareTerminalIcon size={12} />
            {tab.title}
            <ActionIcon
              icon={XIcon}
              size={'small'}
              title={t('terminalPanel.closeTab')}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(topicKey, tab.id);
              }}
            />
          </div>
        ))}
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
