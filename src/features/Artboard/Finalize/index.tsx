import { createModal, Flexbox, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';

import FinalizeContent from './FinalizeContent';
import PendingItem from './PendingItem';

const ResolveContent = ({ artboardId, noteId }: { artboardId: string; noteId: string }) => {
  const { close } = useModalContext();
  return (
    <Flexbox paddingBlock={'0 8px'}>
      <PendingItem artboardId={artboardId} noteId={noteId} onDiscuss={close} onResolved={close} />
    </Flexbox>
  );
};

export const createFinalizeModal = (artboardId: string) =>
  createModal({
    content: <FinalizeContent artboardId={artboardId} />,
    footer: null,
    title: t('artboard.finalize.title', { ns: 'project' }),
    width: 560,
  });

export const createResolveModal = (artboardId: string, noteId: string) =>
  createModal({
    content: <ResolveContent artboardId={artboardId} noteId={noteId} />,
    footer: null,
    title: t('artboard.resolve.title', { ns: 'project' }),
    width: 440,
  });
