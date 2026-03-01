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
      open={open}
      title={null}
      width={960}
      styles={{
        body: {
          height: '60vh',
          overflow: 'scroll',
          padding: 0,
          position: 'relative',
        },
      }}
      onCancel={onCancel}
    >
      <Content />
    </Modal>
  );
});

export default AgentSettings;
