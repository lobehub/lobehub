import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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
        className={styles.indicator}
        id={id}
        style={{ width }}
        onClick={() => onJump(virtuosoIndex)}
      >
        <div className={cx(styles.indicatorContent, isActive && styles.indicatorContentActive)} />
      </div>
    );
  },
);

MinimapIndicator.displayName = 'MinimapIndicator';
