'use client';

import { Modal } from '@lobehub/ui';
import type { PropsWithChildren } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OverlayContainerContext } from '@/features/NavPanel/OverlayContainer';
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
  const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);

  useFetchTopics();

  return (
    <OverlayContainerContext value={overlayContainer}>
      <Modal
        allowFullscreen
        footer={null}
        open={open}
        title={t('title')}
        styles={{
          body: { padding: 0 },
        }}
        onCancel={() => setOpen(false)}
      >
        <div ref={setOverlayContainer} style={{ height: '100%' }}>
          {children}
        </div>
      </Modal>
    </OverlayContainerContext>
  );
});

export default Topics;
