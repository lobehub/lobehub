'use client';

import { createModal, Flexbox, useModalContext } from '@lobehub/ui';
import { useEffect } from 'react';

import BoardView from '../Board';
import { artboardActions } from '../store';
import { useArtboardFeature } from '../useArtboardFeature';

const GalleryBoard = ({ artboardId }: { artboardId: string }) => {
  const { close } = useModalContext();
  const { enabled } = useArtboardFeature();
  useEffect(() => {
    artboardActions.setGallery(true);
    return () => artboardActions.setGallery(false);
  }, []);
  if (!enabled) return null;
  return (
    <Flexbox height={'100%'} style={{ minHeight: 0 }} width={'100%'}>
      <BoardView artboardId={artboardId} onExitFullscreen={close} />
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
