import type { ArtboardFrame } from '@lobechat/types';
import { Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { ImageIcon, LockIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { flowStateColor } from '@/features/Acceptance/Viewer/Flow/FlowNode';
import { sx } from '@/styles/sx';

import { FRAME_W } from '../model';
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

interface FrameLabelProps {
  frame: ArtboardFrame;
  k: number;
  linked: boolean;
  state?: FlowNodeState;
  verify: boolean;
}

const FrameLabel = ({ frame, k, linked, state, verify }: FrameLabelProps) => {
  const { t } = useTranslation('project');
  const screenWidth = FRAME_W * k;
  if (screenWidth < 90) return null;

  if (screenWidth < 320)
    return (
      <ScaledLabel gap={4} k={k} width={FRAME_W}>
        <Flexbox horizontal align="center" gap={4} style={{ minWidth: 0 }}>
          {verify && linked && (
            <Icon color={flowStateColor(state)} icon={stateIcon(state)} size={12} />
          )}
          <Text ellipsis strong style={{ fontSize: 12 }}>
            {frame.title}
          </Text>
        </Flexbox>
      </ScaledLabel>
    );

  return (
    <ScaledLabel k={k} width={FRAME_W}>
      <Flexbox
        horizontal
        align="center"
        gap={6}
        style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
      >
        <Text code style={{ flex: 'none', fontSize: 11 }} type="secondary">
          {frame.id}
        </Text>
        <Text ellipsis strong style={{ fontSize: 13 }}>
          {frame.title}
        </Text>
        {frame.recommended && (
          <Tag color="success" size={'small'}>
            {t('artboard.frame.recommended')}
          </Tag>
        )}
        {frame.source.kind === 'image' && (
          <Tag icon={<Icon icon={ImageIcon} />} size={'small'}>
            {t('artboard.frame.image')}
          </Tag>
        )}
        {frame.source.kind === 'canvas' && frame.source.version > 1 && (
          <Tag size={'small'}>v{frame.source.version}</Tag>
        )}
        <div style={{ flex: 1 }} />
        {linked && !verify && (
          <Tag icon={<Icon icon={LockIcon} />} size={'small'}>
            {t('artboard.frame.locked')}
          </Tag>
        )}
        {verify && linked && <StatusTag state={state} />}
      </Flexbox>
    </ScaledLabel>
  );
};

export default FrameLabel;
