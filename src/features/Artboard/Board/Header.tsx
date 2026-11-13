import { ActionIcon, Button, Flexbox, Icon, Segmented, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ClipboardCheckIcon,
  ListTreeIcon,
  LockIcon,
  Maximize2Icon,
  Minimize2Icon,
  StampIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useBoard } from '../BoardContext';
import { createFinalizeModal } from '../Finalize';
import { artboardActions, useArtboardStore } from '../store';
import type { BoardMode } from '../types';

const styles = stylex.create({
  bar: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    minHeight: 44,
    paddingBlock: 6,
    paddingInline: 12,
  },
});

interface HeaderProps {
  narrow: boolean;
  onExitFullscreen?: () => void;
}

const Header = ({ narrow, onExitFullscreen }: HeaderProps) => {
  const { t } = useTranslation('project');
  const board = useBoard();
  const { finalized } = board;
  const pendingLeft = board.blockers.length;
  const { mode, outlineOpen, verifyOpen } = useArtboardStore((s) => ({
    mode: s.mode,
    outlineOpen: s.outlineOpen,
    verifyOpen: s.verifyOpen,
  }));

  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={8}
      justify={'space-between'}
      wrap={'wrap'}
      {...stylex.props(styles.bar)}
    >
      <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
        {!narrow && (
          <ActionIcon
            active={outlineOpen}
            disabled={mode === 'verify'}
            icon={ListTreeIcon}
            size={'small'}
            title={t('artboard.header.outline')}
            onClick={() => artboardActions.setOutlineOpen(!outlineOpen)}
          />
        )}
        <Text ellipsis strong style={{ minWidth: 0 }}>
          {board.artboard.title}
        </Text>
        <Tag size={'small'} style={{ flex: 'none' }}>
          {finalized ? t('artboard.header.phaseFinalized') : t('artboard.header.phaseDraft')}
        </Tag>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={8}>
        <Segmented
          size={'small'}
          value={mode}
          options={[
            { label: t('artboard.header.discuss'), value: 'discuss' },
            {
              disabled: !finalized,
              label: t('artboard.header.verify'),
              title: finalized ? undefined : t('artboard.header.verifyLocked'),
              value: 'verify',
            },
          ]}
          onChange={(value) => artboardActions.setMode(value as BoardMode)}
        />
        {finalized ? (
          <Tag color={'success'} icon={<Icon icon={LockIcon} />} size={'small'}>
            {t('artboard.header.finalized')}
          </Tag>
        ) : (
          <Button
            icon={StampIcon}
            size={'small'}
            type={'primary'}
            onClick={() => createFinalizeModal(board.artboard.id)}
          >
            {narrow
              ? t('artboard.header.finalizeShort')
              : pendingLeft
                ? t('artboard.header.finalizePending', { count: pendingLeft })
                : t('artboard.header.finalize')}
          </Button>
        )}
        {mode === 'verify' && (
          <ActionIcon
            active={verifyOpen}
            icon={ClipboardCheckIcon}
            size={'small'}
            title={t('artboard.header.verifyPanel')}
            onClick={() => artboardActions.setVerifyOpen(!verifyOpen)}
          />
        )}
        <ActionIcon
          icon={onExitFullscreen ? Minimize2Icon : Maximize2Icon}
          size={'small'}
          title={t(
            onExitFullscreen ? 'artboard.header.exitFullscreen' : 'artboard.header.fullscreen',
          )}
          onClick={onExitFullscreen ?? (() => artboardActions.setFullscreen(true))}
        />
      </Flexbox>
    </Flexbox>
  );
};

export default Header;
