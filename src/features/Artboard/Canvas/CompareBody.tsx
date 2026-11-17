import type { ArtboardBoardView } from '@lobechat/types';
import { Tag } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import BoardBody from './BoardBody';

const styles = stylex.create({
  half: {
    backgroundColor: cssVar.colorBgLayout,
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  label: {
    insetBlockStart: 8,
    insetInlineStart: 8,
    position: 'absolute',
  },
  root: {
    display: 'flex',
    gap: 2,
    height: '100%',
    width: '100%',
  },
  scaled: {
    insetInlineStart: 0,
    pointerEvents: 'none',
    position: 'absolute',
    transformOrigin: '0 0',
  },
});

const Half = ({
  board,
  children,
  label,
}: {
  board: ArtboardBoardView;
  children: ReactNode;
  label: string;
}) => {
  const { h, w } = board.rect;
  return (
    <div {...stylex.props(styles.half)}>
      <div
        {...sx(styles.scaled, {
          height: h,
          top: h / 4,
          transform: 'scale(0.5)',
          width: w,
        })}
      >
        {children}
      </div>
      <Tag size={'small'} {...stylex.props(styles.label)}>
        {label}
      </Tag>
    </div>
  );
};

interface CompareBodyProps {
  board: ArtboardBoardView;
  imageUrl?: string;
  k: number;
  screenshotUrl: string;
}

const CompareBody = ({ board, imageUrl, k, screenshotUrl }: CompareBodyProps) => {
  const { t } = useTranslation('project');
  return (
    <div {...stylex.props(styles.root)}>
      <Half board={board} label={t('artboard.compare.design')}>
        <BoardBody live board={board} imageUrl={imageUrl} k={k / 2} />
      </Half>
      <Half board={board} label={t('artboard.compare.real')}>
        <BoardBody live board={board} k={k / 2} screenshotUrl={screenshotUrl} />
      </Half>
    </div>
  );
};

export default CompareBody;
