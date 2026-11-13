import { ActionIcon, Flexbox, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  Maximize2Icon,
  MessageSquareQuoteIcon,
  ScanIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { openCanvasModal } from '@/features/CanvasModal/loader';
import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { addBoardReference } from '../data/addBoardReference';
import { boardReference } from '../data/references';
import { artboardActions, useArtboardStore } from '../store';
import type { ViewState } from './useViewport';

export const floatStyles = stylex.create({
  float: {
    backgroundColor: cssVar.colorBgContainer,
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 4px 16px rgb(0 0 0 / 6%)',
    padding: 4,
    position: 'absolute',
    zIndex: 5,
  },
  selectionBar: {
    transform: 'translate(-100%, calc(-100% - 36px))',
    zIndex: 6,
  },
});

export const SelectionBar = ({ view }: { view: ViewState }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const selected = useArtboardStore((s) =>
    s.mode === 'discuss' && s.selected ? board.boardById[s.selected] : undefined,
  );
  const gallery = useArtboardStore((s) => s.gallery);
  if (!selected || selected.pageId !== board.pageId) return null;

  const refer = () => {
    const reference = boardReference(board, selected.id, '');
    if (!reference || !addBoardReference(reference)) return toast.error(t('artboard.chat.noInput'));
    artboardActions.select(null);
  };

  const { rect, source } = selected;
  const imageUrl = source?.kind === 'image' ? board.imageUrls[source.fileId] : undefined;
  const openFull = () => {
    if (source?.kind === 'canvas') void openCanvasModal(source.canvasId, source.version);
    else if (imageUrl) window.open(imageUrl, '_blank', 'noopener');
  };

  return (
    <Flexbox
      horizontal
      gap={2}

      {...sx([floatStyles.float, floatStyles.selectionBar], undefined, {
        left: (rect.x + rect.w) * view.k + view.x,
        top: rect.y * view.k + view.y,
      })}
    >
      <ActionIcon
        disabled={source?.kind === 'canvas' ? false : !imageUrl}
        icon={Maximize2Icon}
        size={'small'}
        title={t('artboard.selection.view')}
        onClick={openFull}
      />
      {!gallery && (
        <ActionIcon
          icon={MessageSquareQuoteIcon}
          size={'small'}
          title={t('artboard.selection.discuss')}
          onClick={refer}
        />
      )}
    </Flexbox>
  );
};

interface ZoomBarProps {
  k: number;
  onFit: () => void;
  onZoom: (factor: number) => void;
}

export const ZoomBar = ({ k, onFit, onZoom }: ZoomBarProps) => {
  const { t } = useTranslation('project');
  return (
    <Flexbox
      horizontal
      align="center"
      gap={2}

      {...sx(floatStyles.float, undefined, {
        insetBlockEnd: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        insetInlineStart: 12,
      })}
    >
      <ActionIcon
        icon={ZoomOutIcon}
        size={'small'}
        title={t('artboard.zoom.out')}
        onClick={() => onZoom(1 / 1.25)}
      />
      <Text
        style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'center', width: 44 }}
      >
        {Math.round(k * 100)}%
      </Text>
      <ActionIcon
        icon={ZoomInIcon}
        size={'small'}
        title={t('artboard.zoom.in')}
        onClick={() => onZoom(1.25)}
      />
      <ActionIcon icon={ScanIcon} size={'small'} title={t('artboard.zoom.fit')} onClick={onFit} />
    </Flexbox>
  );
};
