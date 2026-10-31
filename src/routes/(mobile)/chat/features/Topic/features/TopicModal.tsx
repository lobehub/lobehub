'use client';

import type { PropsWithChildren } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { OverlayContainerContext } from '@/features/NavPanel/OverlayContainer';
import { useFetchChatTopics } from '@/hooks/useFetchChatTopics';
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

  // The same canonical query as the list inside: both write this container's
  // bucket, so a looser fetch landing last would bring back filtered-out topics.
  useFetchChatTopics();

  return (
    <OverlayContainerContext value={overlayContainer}>
      <ImperativeModal
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
      </ImperativeModal>
    </OverlayContainerContext>
  );
});

export default Topics;
