import { Flexbox, Modal } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useServerConfigStore } from '@/store/serverConfig';

import List from './List';

interface AttachKnowledgeModalProps {
  open?: boolean;
  setOpen: (open: boolean) => void;
}

export const AttachKnowledgeModal = memo<AttachKnowledgeModalProps>(({ setOpen, open }) => {
  const { t } = useTranslation('chat');
  const mobile = useServerConfigStore((s) => s.isMobile);

  return (
    <Modal
      allowFullscreen
      footer={null}
      open={open}
      styles={{ body: { overflow: 'hidden' } }}
      title={t('knowledgeBase.library.title')}
      width={600}
      onCancel={() => {
        setOpen(false);
      }}
    >
      <Flexbox
        gap={mobile ? 8 : 16}
        style={{ maxHeight: mobile ? '-webkit-fill-available' : 'inherit' }}
        width={'100%'}
      >
        <List />
      </Flexbox>
    </Modal>
  );
});
