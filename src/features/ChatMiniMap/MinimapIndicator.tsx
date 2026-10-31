import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { sx } from '@/styles/sx';

import { indicatorStyles } from './styles';
import { type MinimapIndicatorProps } from './types';

export const MinimapIndicator = memo<MinimapIndicatorProps>(
  ({ id, width, virtuosoIndex, position, activePosition, onJump }) => {
    const { t } = useTranslation('chat');
    const styles = indicatorStyles;

    const isActive = activePosition === position;

    return (
      <div
        aria-current={isActive ? 'true' : undefined}
        aria-label={t('minimap.jumpToMessage', { index: position + 1 })}
        id={id}
        {...sx([styles.indicator], undefined, { width })}
        onClick={() => onJump(virtuosoIndex)}
      >
        <div
          {...stylex.props(styles.indicatorContent, isActive && styles.indicatorContentActive)}
        />
      </div>
    );
  },
);

MinimapIndicator.displayName = 'MinimapIndicator';
