import { ActionIcon, Button, DropdownMenu } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { GlobeIcon, LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { artboardService } from '@/services/artboard';
import { useHeaderActionSize } from '@/styles/density';
import { sidebarRow } from '@/styles/density.stylex';

import { useBoard } from '../BoardContext';
import { floatStyles } from '../Viewport/floatStyles';
import { useArtboardShareTrigger } from './useArtboardShare';

const styles = stylex.create({
  button: {
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: sidebarRow.radius,
    flex: 'none',
    fontSize: 12,
    gap: 6,
    height: sidebarRow.controlHeight,
    paddingInline: 10,
  },
  dot: {
    backgroundColor: cssVar.colorWarning,
    borderRadius: '50%',
    flex: 'none',
    height: 6,
    width: 6,
  },
});

const ShareButton = ({ compact }: { compact?: boolean }) => {
  const { t } = useTranslation('project');
  const headerActionSmallSize = useHeaderActionSize(true);
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

  const published = trigger.kind === 'menu';
  const icon = published ? GlobeIcon : LockIcon;
  const label = trigger.kind === 'action' ? trigger.action.label : t('artboard.share.trigger');
  const disabled = trigger.kind === 'action' && trigger.action.disabled;

  const button = compact ? (
    <ActionIcon
      disabled={disabled}
      icon={icon}
      size={headerActionSmallSize}
      title={label}
      onClick={trigger.kind === 'action' ? trigger.action.onClick : undefined}
    />
  ) : (
    <Button
      disabled={disabled}
      icon={icon}
      {...stylex.props(styles.button)}
      onClick={trigger.kind === 'action' ? trigger.action.onClick : undefined}
    >
      {label}
      {data?.hasUpdates && <span {...stylex.props(styles.dot)} />}
    </Button>
  );

  return (
    <>
      <span {...stylex.props(floatStyles.divider)} />
      {trigger.kind === 'action' ? (
        button
      ) : (
        <DropdownMenu items={trigger.items} placement={'bottomRight'}>
          {button}
        </DropdownMenu>
      )}
    </>
  );
};

export default ShareButton;
