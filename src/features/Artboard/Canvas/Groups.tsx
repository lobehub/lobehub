import { Flexbox, Icon, Text } from '@lobehub/ui';
import { LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { useBoard } from '../BoardContext';
import { useArtboardStore } from '../store';
import { ScaledLabel } from './BoardLabel';
import { canvasStyles } from './styles';

const Groups = ({ k }: { k: number }) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const verify = useArtboardStore((s) => s.mode === 'verify');

  return board.groups.map((group) => {
    const { rect } = group;
    if (!rect.w || !rect.h) return null;
    const journey = group.id === board.journeyGroupId;
    const locked = board.finalized && journey;
    const round = board.roundByGroupId[group.id];
    const desc = locked
      ? t(verify ? 'artboard.group.verifyDesc' : 'artboard.group.lockedDesc')
      : round
        ? round.title || t('artboard.group.choose')
        : group.desc;
    return (
      <div
        key={group.id}
        {...sx([canvasStyles.group, locked && canvasStyles.groupLocked], undefined, {
          height: rect.h,
          left: rect.x,
          opacity: verify && !journey ? 0.3 : 1,
          top: rect.y,
          width: rect.w,
        })}
      >
        <ScaledLabel gap={6} k={k} width={rect.w}>
          <Flexbox
            horizontal
            align="center"
            gap={8}
            style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
          >
            {locked && <Icon icon={LockIcon} size={13} />}
            <Text strong style={{ flex: 'none', fontSize: 15 }}>
              {group.title}
            </Text>
            {rect.w * k > 420 && (
              <Text ellipsis style={{ fontSize: 12 }} type="secondary">
                {desc}
              </Text>
            )}
          </Flexbox>
        </ScaledLabel>
      </div>
    );
  });
};

export default Groups;
