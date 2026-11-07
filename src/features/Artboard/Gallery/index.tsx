'use client';

import { createModal, Flexbox, useModalContext } from '@lobehub/ui';

import BoardView from '../Board';
import { useArtboardFeature } from '../useArtboardFeature';
import GalleryFooter from './GalleryFooter';

const GalleryBoard = ({ artboardId }: { artboardId: string }) => {
  const { close } = useModalContext();
  const { enabled } = useArtboardFeature();
  if (!enabled) return null;
  return (
    <Flexbox height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <BoardView artboardId={artboardId} onExitFullscreen={close} />
      <GalleryFooter artboardId={artboardId} onLeave={close} />
    </Flexbox>
  );
};

export const createArtboardGalleryModal = (artboardId: string) =>
  createModal({
    content: <GalleryBoard artboardId={artboardId} />,
    footer: null,
    styles: {
      content: { display: 'flex', height: 'calc(100vh - 64px)', padding: 0 },
    },
    title: null,
    width: '100vw',
  });
