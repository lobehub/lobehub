'use client';

import { createModal } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import ArtifactBoardView from './BoardView';

const ArtifactBoardModalTitle = () => {
  const { t } = useTranslation('portal');
  return t('board.title');
};

export const createArtifactBoardModal = (boardId: string) =>
  createModal({
    content: <ArtifactBoardView boardId={boardId} />,
    footer: null,
    maskClosable: true,
    styles: { content: { display: 'flex', height: '85vh', minHeight: 0, padding: 0 } },
    title: <ArtifactBoardModalTitle />,
    width: 'min(96vw, 1440px)',
  });
