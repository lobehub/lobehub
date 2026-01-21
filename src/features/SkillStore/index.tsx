'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Content from './Content';

interface SkillStoreProps {
  onClose: () => void;
  open: boolean;
}

export const SkillStore = memo<SkillStoreProps>(({ onClose, open }) => {
  const { t } = useTranslation('setting');

  return (
    <Modal
      allowFullscreen
      destroyOnClose={false}
      footer={null}
      onCancel={onClose}
      open={open}
      styles={{
        body: { overflow: 'hidden', padding: 0 },
      }}
      title={t('skillStore.title')}
      width={'min(80%, 800px)'}
    >
      <Content />
    </Modal>
  );
});

SkillStore.displayName = 'SkillStore';

export default SkillStore;
