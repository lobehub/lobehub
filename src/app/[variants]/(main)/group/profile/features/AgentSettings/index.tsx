'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';

import Content from './Content';

interface AgentSettingsProps {
  onCancel: () => void;
  open: boolean;
}

const AgentSettings = memo<AgentSettingsProps>(({ open, onCancel }) => {
  return (
    <Modal
      centered
      footer={null}
      onCancel={onCancel}
      open={open}
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
