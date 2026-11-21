'use client';

import { type ActionIconGroupProps, type ActionIconProps } from '@lobehub/ui';
import { ActionIconGroup } from '@lobehub/ui';
import { Dices, Download, Share2, Trash2 } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './styles';
import { type ActionButtonsProps } from './types';

const actionIconProps: Partial<Omit<ActionIconProps, 'size' | 'ref' | 'icon'>> = {
  tooltipProps: { placement: 'left' },
};
// Action buttons component
export const ActionButtons = memo<ActionButtonsProps>(
  ({
    onDelete,
    onDownload,
    onCopySeed,
    onShare,
    showDownload = false,
    showCopySeed = false,
    seedTooltip,
  }) => {
    const { t } = useTranslation(['image', 'chat']);

    return (
      <ActionIconGroup
        actionIconProps={actionIconProps}
        className={styles.generationActionButton}
        horizontal={false}
        variant="outlined"
        items={useMemo(
          () =>
            [
              Boolean(showDownload && onDownload) && {
                icon: Download,
                key: 'download',
                label: t('generation.actions.download'),
                onClick: onDownload,
              },
              Boolean(onShare) && {
                icon: Share2,
                key: 'share',
                label: t('shareModal.generation.entry', { ns: 'chat' }),
                onClick: onShare,
              },
              Boolean(showCopySeed && onCopySeed) && {
                icon: Dices,
                key: 'copySeed',
                label: seedTooltip,
                onClick: onCopySeed,
              },
              {
                danger: true,
                icon: Trash2,
                key: 'delete',
                label: t('generation.actions.delete'),
                onClick: onDelete,
              },
            ].filter(Boolean) as ActionIconGroupProps['items'],
          [showDownload, onDownload, onShare, showCopySeed, onCopySeed, seedTooltip, onDelete, t],
        )}
      />
    );
  },
);

ActionButtons.displayName = 'ActionButtons';
