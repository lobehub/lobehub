'use client';

import { Modal } from '@lobehub/ui';
import { type PropsWithChildren, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFetchTopics } from '@/hooks/useFetchTopics';
import { useWorkspaceModal } from '@/hooks/useWorkspaceModal';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

const Topics = memo(({ children }: PropsWithChildren) => {
  const [showAgentSettings, toggleConfig] = useGlobalStore((s) => [
    systemStatusSelectors.mobileShowTopic(s),
    s.toggleMobileTopic,
  ]);
  const [open, setOpen] = useWorkspaceModal(showAgentSettings, toggleConfig);
  const { t } = useTranslation('topic');

  useFetchTopics();

  return (
    <Modal
      allowFullscreen
      footer={null}
      onCancel={() => setOpen(false)}
      open={open}
      styles={{
        body: { padding: 0 },
      }}
      title={t('title')}
    >
      {children}
    </Modal>
  );
});

export default Topics;
