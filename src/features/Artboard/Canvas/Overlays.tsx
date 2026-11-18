import { ActionIcon, Flexbox, Segmented, toast } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { Maximize2Icon, MessageSquareQuoteIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { addBoardReference } from '../data/addBoardReference';
import { boardReference } from '../data/references';
import { boardFileUrl } from '../model';
import { artboardActions, useArtboardStore } from '../store';
import type { CompareView } from '../types';
import { nodeScreenshot } from '../Verify/flow';
import { useJourneyView } from '../Verify/useJourneyView';
import { floatStyles } from '../Viewport/floatStyles';
import type { ViewState } from './useViewport';

const SELECTION_BAR_MIN_LEFT = 80;
const SELECTION_BAR_MIN_TOP = 80;

export const SelectionBar = ({ view }: { view: ViewState }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const selected = useArtboardStore((s) =>
    s.mode === 'discuss' && s.selected ? board.boardById[s.selected] : undefined,
  );
  const noChatInput = useArtboardStore((s) => s.gallery || s.fullscreen);
  if (!selected || selected.pageId !== board.pageId) return null;

  const refer = () => {
    const reference = boardReference(board, selected.id, '');
    if (!reference || !addBoardReference(reference)) return toast.error(t('artboard.chat.noInput'));
    artboardActions.select(null);
  };

  const { rect } = selected;
  const fileUrl = boardFileUrl(board, selected);
  const openFull = () => {
    if (fileUrl) window.open(fileUrl, '_blank', 'noopener');
  };

  return (
    <Flexbox
      horizontal
      gap={2}

      {...sx(floatStyles.float, floatStyles.selectionBar, {
        left: Math.max(SELECTION_BAR_MIN_LEFT, (rect.x + rect.w) * view.k + view.x),
        top: Math.max(SELECTION_BAR_MIN_TOP, rect.y * view.k + view.y),
      })}
    >
      <ActionIcon
        disabled={!fileUrl}
        icon={Maximize2Icon}
        size={'small'}
        title={t('artboard.selection.view')}
        onClick={openFull}
      />
      {!noChatInput && (
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

export const CompareBar = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const journey = useJourneyView();
  const { compare, selected } = useArtboardStore((s) => ({
    compare: s.compare,
    selected: s.mode === 'verify' && s.selected ? board.boardById[s.selected] : undefined,
  }));
  if (!selected || selected.pageId !== board.pageId || !nodeScreenshot(journey, selected.id))
    return null;

  return (
    <div {...stylex.props(floatStyles.topCenter)}>
      <Segmented
        size={'small'}
        value={compare}
        options={[
          { label: t('artboard.compare.real'), value: 'real' },
          { label: t('artboard.compare.design'), value: 'design' },
          { label: t('artboard.compare.split'), value: 'split' },
        ]}
        onChange={(value) => artboardActions.setCompare(value as CompareView)}
      />
    </div>
  );
};
