'use client';

import { Flexbox, Modal, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PageExplorer from '@/features/PageExplorer';
import { pageSelectors, usePageStore } from '@/store/page';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

const PageModal = memo(() => {
  const { t } = useTranslation('chat');
  const pageId = useTaskStore(taskDetailSelectors.activePageModalId);
  const closePageModal = useTaskStore((s) => s.closePageModal);
  const document = usePageStore(pageSelectors.getDocumentById(pageId));

  const open = !!pageId;
  const emoji = document?.metadata?.emoji as string | undefined;
  const title = document?.title || t('taskDetail.untitled');

  return (
    <Modal
      allowFullscreen
      centered
      destroyOnHidden
      footer={null}
      open={open}
      width={'min(90vw, 1280px)'}
      styles={{
        body: { height: '80vh', overflow: 'hidden', padding: 0 },
      }}
      title={
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          {emoji && <span style={{ fontSize: 18, lineHeight: 1 }}>{emoji}</span>}
          <Text ellipsis style={{ minWidth: 0 }} weight={600}>
            {title}
          </Text>
        </Flexbox>
      }
      onCancel={closePageModal}
    >
      {open && pageId && <PageExplorer pageId={pageId} />}
    </Modal>
  );
});

PageModal.displayName = 'PageModal';

export default PageModal;
