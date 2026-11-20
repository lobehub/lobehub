import { createModal, Flexbox, type ModalInstance } from '@lobehub/ui';
import { t } from 'i18next';
import { memo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

import { type PickerKind } from './filterPickerItems';
import List from './List';

export type { PickerKind } from './filterPickerItems';

const Content = memo<{ kind: PickerKind }>(({ kind }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);

  return (
    <Flexbox
      gap={mobile ? 8 : 16}
      style={{ maxHeight: mobile ? '-webkit-fill-available' : 'inherit' }}
      width={'100%'}
    >
      <List defaultKind={kind} />
    </Flexbox>
  );
});

interface AttachKnowledgeModalOptions {
  /** The tab to open on; "Add file" lands on files, everything else on libraries. */
  kind?: PickerKind;
}

export const openAttachKnowledgeModal = ({
  kind = 'library',
}: AttachKnowledgeModalOptions = {}): ModalInstance =>
  createModal({
    content: <Content kind={kind} />,
    footer: false,
    styles: { content: { overflow: 'hidden' } },
    title: t('knowledgeBase.picker.title', { ns: 'chat' }),
    width: 600,
  });
