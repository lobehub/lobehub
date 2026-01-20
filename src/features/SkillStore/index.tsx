'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Content from './Content';

interface SkillStoreProps {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const SkillStore = memo<SkillStoreProps>(({ open, setOpen }) => {
  const { t } = useTranslation('setting');

  return (
    <Modal
      allowFullscreen
      destroyOnClose={false}
      footer={null}
      onCancel={() => setOpen(false)}
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
