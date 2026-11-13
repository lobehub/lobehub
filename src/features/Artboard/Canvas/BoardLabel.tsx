import type { ArtboardBoardView } from '@lobechat/types';
import { Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { ImageIcon, LockIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { flowStateColor } from '@/features/Acceptance/Viewer/Flow/FlowNode';
import { sx } from '@/styles/sx';

import StatusTag, { stateIcon } from '../StatusTag';
import type { FlowNodeState } from '../Verify/flow';
import { canvasStyles } from './styles';

interface ScaledLabelProps {
  children: ReactNode;
  gap?: number;
  k: number;
  width: number;
}

export const ScaledLabel = ({ children, gap = 8, k, width }: ScaledLabelProps) => (
  <div
    {...sx(canvasStyles.scaledLabel, undefined, {
      paddingBottom: gap,
      transform: `scale(${1 / k})`,
      width: width * k,
    })}
  >
    {children}
  </div>
);

interface BoardLabelProps {
  board: ArtboardBoardView;
  k: number;
  linked: boolean;
  recommended: boolean;
  state?: FlowNodeState;
  verify: boolean;
}

const BoardLabel = ({ board, k, linked, recommended, state, verify }: BoardLabelProps) => {
  const { t } = useTranslation('project');
  const { source } = board;
  const width = board.rect.w;
  const screenWidth = width * k;
  if (screenWidth < 90) return null;

  if (screenWidth < 320)
    return (
      <ScaledLabel gap={4} k={k} width={width}>
        <Flexbox horizontal align="center" gap={4} style={{ minWidth: 0 }}>
          {verify && linked && (
            <Icon color={flowStateColor(state)} icon={stateIcon(state)} size={12} />
          )}
          <Text ellipsis strong style={{ fontSize: 12 }}>
            {board.title}
          </Text>
        </Flexbox>
      </ScaledLabel>
    );

  return (
    <ScaledLabel k={k} width={width}>
      <Flexbox
        horizontal
        align="center"
        gap={6}
        style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
      >
        <Text ellipsis strong style={{ fontSize: 13 }}>
          {board.title}
        </Text>
        {recommended && (
          <Tag color="success" size={'small'}>
            {t('artboard.board.recommended')}
          </Tag>
        )}
        {board.type === 'decision' && <Tag size={'small'}>{t('artboard.board.decision')}</Tag>}
        {source?.kind === 'image' && (
          <Tag icon={<Icon icon={ImageIcon} />} size={'small'}>
            {t('artboard.board.image')}
          </Tag>
        )}
        {source?.kind === 'canvas' && source.version > 1 && (
          <Tag size={'small'}>v{source.version}</Tag>
        )}
        <div style={{ flex: 1 }} />
        {linked && !verify && (
          <Tag icon={<Icon icon={LockIcon} />} size={'small'}>
            {t('artboard.board.locked')}
          </Tag>
        )}
        {verify && linked && <StatusTag state={state} />}
      </Flexbox>
    </ScaledLabel>
  );
};

export default BoardLabel;
