import { Flexbox } from '@lobehub/ui';
import { createModal, type ModalInstance } from '@lobehub/ui/base-ui';
import { t } from 'i18next';
import { memo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

import List from './List';

const Content = memo(() => {
  const mobile = useServerConfigStore((s) => s.isMobile);

  return (
    <Flexbox
      gap={mobile ? 8 : 16}
      style={{ maxHeight: mobile ? '-webkit-fill-available' : 'inherit' }}
      width={'100%'}
    >
      <List />
    </Flexbox>
  );
});

export const openAttachKnowledgeModal = (): ModalInstance =>
  createModal({
    content: <Content />,
    footer: false,
    styles: { content: { overflow: 'hidden' } },
    title: t('knowledgeBase.library.title', { ns: 'chat' }),
    width: 600,
  });
