import type { ModalInstance } from '@lobehub/ui/base-ui';
import { createModal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useEffect, useMemo, useRef } from 'react';

import { CaseList } from './CaseList';
import { FixtureViewer } from './FixtureViewer/FixtureViewer';
import { PlayerPanel } from './Player/PlayerPanel';
import { SettingsPanel } from './Settings/SettingsPanel';
import { type DevtoolsTab, useAgentMockStore } from './store/agentMockStore';
import { TimelinePanel } from './Timeline/TimelinePanel';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    display: flex;
    height: 100%;
    min-height: 0;
  `,
  content: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 20px;
    padding-inline: 24px;
  `,
  main: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  `,
  tab: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 14px;
    border-block-end: 2px solid transparent;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  tabActive: css`
    border-block-end-color: ${cssVar.colorPrimary};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  tabBar: css`
    display: flex;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

const TABS: Array<{ key: DevtoolsTab; label: string }> = [
  { key: 'player', label: '▶ Player' },
  { key: 'timeline', label: '≡ Timeline' },
  { key: 'fixture', label: '{ } Fixture' },
  { key: 'settings', label: '⚙ Settings' },
];

const ModalContent = memo(() => {
  const activeTab = useAgentMockStore((s) => s.activeTab);
  const setActiveTab = useAgentMockStore((s) => s.setActiveTab);

  const content = useMemo(() => {
    switch (activeTab) {
      case 'player': {
        return <PlayerPanel />;
      }
      case 'timeline': {
        return <TimelinePanel />;
      }
      case 'fixture': {
        return <FixtureViewer />;
      }
      case 'settings': {
        return <SettingsPanel />;
      }
    }
  }, [activeTab]);

  return (
    <div className={styles.body}>
      <CaseList />
      <div className={styles.main}>
        <div className={styles.tabBar}>
          {TABS.map((t) => (
            <div
              className={`${styles.tab} ${activeTab === t.key ? styles.tabActive : ''}`}
              key={t.key}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div className={styles.content}>{content}</div>
      </div>
    </div>
  );
});

ModalContent.displayName = 'AgentMockModalContent';

export const Modal = memo(() => {
  const modalState = useAgentMockStore((s) => s.modalState);
  const setModalState = useAgentMockStore((s) => s.setModalState);
  const instanceRef = useRef<ModalInstance | null>(null);

  useEffect(() => {
    if (modalState === 'open' && !instanceRef.current) {
      instanceRef.current = createModal({
        content: <ModalContent />,
        footer: null,
        onOpenChange: (open) => {
          if (!open) setModalState('minimized');
        },
        title: 'Agent Mock DevTools (dev)',
        width: 1200,
      });
    } else if (modalState !== 'open' && instanceRef.current) {
      instanceRef.current.destroy();
      instanceRef.current = null;
    }
  }, [modalState, setModalState]);

  useEffect(
    () => () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    },
    [],
  );

  return null;
});

Modal.displayName = 'AgentMockModal';
