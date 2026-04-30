import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback } from 'react';

import { useChatStore } from '@/store/chat/store';

import { useAgentMockStore } from '../store/agentMockStore';

const styles = createStaticStyles(({ css }) => ({
  block: css`
    display: flex;
    gap: 12px;
    align-items: center;

    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    font-size: 12px;

    background: ${cssVar.colorBgContainer};
  `,
  pill: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 14px;
  `,
  active: css`
    border-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};
  `,
}));

export const TargetPicker = memo(() => {
  const targetMode = useAgentMockStore((s) => s.targetMode);
  const setTargetMode = useAgentMockStore((s) => s.setTargetMode);
  const activeMockTopicId = useAgentMockStore((s) => s.activeMockTopicId);
  const setActiveMockTopicId = useAgentMockStore((s) => s.setActiveMockTopicId);
  const selectedCaseId = useAgentMockStore((s) => s.selectedCaseId);

  const createMockTopic = useCallback(async () => {
    if (!selectedCaseId) return;
    const title = `[MOCK] ${selectedCaseId} @ ${new Date().toTimeString().slice(0, 8)}`;
    const state = useChatStore.getState();
    const sessionId = state.activeAgentId ?? 'mock-session';
    const id = await state.internal_createTopic({
      messages: [],
      sessionId,
      title,
    });
    setActiveMockTopicId(id);
  }, [selectedCaseId, setActiveMockTopicId]);

  return (
    <div className={styles.block}>
      <span style={{ fontWeight: 500 }}>Target:</span>
      <span
        className={`${styles.pill} ${targetMode === 'new-topic' ? styles.active : ''}`}
        onClick={() => {
          setTargetMode('new-topic');
          void createMockTopic();
        }}
      >
        ＋ new mock topic
      </span>
      <span
        className={`${styles.pill} ${targetMode === 'current-topic' ? styles.active : ''}`}
        onClick={() => {
          setTargetMode('current-topic');
          const currentTopicId = useChatStore.getState().activeTopicId;
          if (currentTopicId) setActiveMockTopicId(currentTopicId);
        }}
      >
        → current topic
      </span>
      <span style={{ marginInlineStart: 'auto', color: cssVar.colorTextTertiary }}>
        {activeMockTopicId ? `topic: ${activeMockTopicId.slice(0, 8)}…` : 'no topic'}
      </span>
    </div>
  );
});

TargetPicker.displayName = 'AgentMockTargetPicker';
