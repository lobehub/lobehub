import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { previewStyles } from './styles';
import { type MinimapIndicator } from './types';

interface MinimapPreviewProps {
  activePosition: number | null;
  indicators: MinimapIndicator[];
  onJump: (virtuosoIndex: number) => void;
}

export const MinimapPreview = memo<MinimapPreviewProps>(
  ({ indicators, activePosition, onJump }) => {
    const { t } = useTranslation('chat');
    const styles = previewStyles;

    return (
      <Flexbox className={stylex.props(styles.list).className} gap={2}>
        {indicators.map(({ id, preview, virtuosoIndex, width }, position) => {
          const isActive = activePosition === position;
          const label = preview || t('minimap.emptyPreview');

          return (
            <Flexbox
              horizontal
              align={'center'}
              aria-current={isActive ? 'true' : undefined}
              className={stylex.props(styles.item, isActive && styles.itemActive).className}
              gap={10}
              justify={'flex-end'}
              key={id}
              onClick={() => onJump(virtuosoIndex)}
            >
              <span {...stylex.props(styles.label, isActive && styles.labelActive)}>{label}</span>
              <div {...sx([styles.dash, isActive && styles.dashActive], undefined, { width })} />
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

MinimapPreview.displayName = 'MinimapPreview';
