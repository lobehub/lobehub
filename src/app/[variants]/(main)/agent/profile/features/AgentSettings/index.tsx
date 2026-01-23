'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';

import { useAgentStore } from '@/store/agent';

import Content from './Content';

const AgentSettings = memo(() => {
  const showAgentSetting = useAgentStore((s) => s.showAgentSetting);

  return (
    <Modal
      centered
      footer={null}
      onCancel={() => useAgentStore.setState({ showAgentSetting: false })}
      open={showAgentSetting}
      styles={{
        body: {
          height: '60vh',
          overflow: 'scroll',
          padding: 0,
          position: 'relative',
        },
      }}
      title={null}
      width={960}
    >
      <Content />
    </Modal>
  );
});

export default AgentSettings;
