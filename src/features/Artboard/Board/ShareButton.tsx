import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { artboardService } from '@/services/artboard';

import { useBoard } from '../BoardContext';
import { useArtboardShareTrigger } from './useArtboardShare';

const ShareButton = () => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const { id, revision } = board.artboard;
  const choices = board.artboard.content.rounds
    .map((round) => `${round.id}:${round.status}:${round.chosenBoardId ?? ''}`)
    .join(',');
  const { data, mutate } = useClientDataSWR(['artboard-publish', id, revision, choices], () =>
    artboardService.getPublish(id),
  );
  const trigger = useArtboardShareTrigger(id, data, () => mutate());

  if (trigger.kind === 'none') return null;

  if (trigger.kind === 'action')
    return (
      <ActionIcon
        disabled={trigger.action.disabled}
        icon={Share2}
        size={'small'}
        title={trigger.action.label}
        onClick={trigger.action.onClick}
      />
    );

  return (
    <DropdownMenu items={trigger.items} placement={'bottomRight'}>
      <ActionIcon icon={Share2} size={'small'} title={t('artboard.share.trigger')} />
    </DropdownMenu>
  );
};

export default ShareButton;
