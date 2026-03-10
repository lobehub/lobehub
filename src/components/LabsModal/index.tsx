'use client';

import { Flexbox, Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

import LabCard from './LabCard';

interface LabItem {
  checked: boolean;
  cover?: string;
  desc: string;
  key: string;
  title: string;
}

interface LabsModalProps {
  onClose: () => void;
  open: boolean;
}

const LabsModal = memo<LabsModalProps>(({ open, onClose }) => {
  const { t } = useTranslation('labs');

  const [isPreferenceInit, enableInputMarkdown, updateLab] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    labPreferSelectors.enableInputMarkdown(s),
    s.updateLab,
  ]);

  const labItems: LabItem[] = [
    {
      checked: enableInputMarkdown,
      cover: 'https://github.com/user-attachments/assets/0527a966-3d95-46b4-b880-c0f3fca18f02',
      desc: t('features.inputMarkdown.desc'),
      key: 'enableInputMarkdown',
      title: t('features.inputMarkdown.title'),
    },
  ];

  return (
    <Modal footer={null} open={open} title={t('title')} width={700} onCancel={onClose}>
      <Flexbox gap={16} padding={16} style={{ alignItems: 'center', width: '100%' }}>
        {labItems.map((item) => (
          <LabCard
            checked={item.checked}
            cover={item.cover}
            desc={item.desc}
            key={item.key}
            loading={!isPreferenceInit}
            title={item.title}
            onChange={(checked: boolean) => updateLab({ [item.key]: checked })}
          />
        ))}
      </Flexbox>
    </Modal>
  );
});

LabsModal.displayName = 'LabsModal';

export default LabsModal;
