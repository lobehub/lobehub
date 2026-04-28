'use client';

import { Modal } from '@lobehub/ui';
import { memo } from 'react';

import PageExplorer from '@/features/PageExplorer';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import PageModalHeader from './Header';

const PageModal = memo(() => {
  const pageId = useTaskStore(taskDetailSelectors.activePageModalId);
  const closePageModal = useTaskStore((s) => s.closePageModal);

  const open = !!pageId;

  return (
    <Modal
      allowFullscreen
      centered
      destroyOnHidden
      closable={false}
      footer={null}
      open={open}
      title={null}
      width={'min(95vw, 1600px)'}
      styles={{
        body: { flex: 1, maxHeight: 'none', minHeight: 0, overflow: 'hidden', padding: 0 },
        container: { display: 'flex', flexDirection: 'column', height: '92vh' },
      }}
      onCancel={closePageModal}
    >
      {open && pageId && <PageExplorer header={<PageModalHeader />} pageId={pageId} />}
    </Modal>
  );
});

PageModal.displayName = 'PageModal';

export default PageModal;
