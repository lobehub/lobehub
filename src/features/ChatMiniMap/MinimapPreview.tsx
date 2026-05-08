import { Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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
      <Flexbox className={styles.list} gap={2}>
        {indicators.map(({ id, preview, virtuosoIndex, width }, position) => {
          const isActive = activePosition === position;
          const label = preview || t('minimap.emptyPreview');

          return (
            <Flexbox
              horizontal
              align={'center'}
              aria-current={isActive ? 'true' : undefined}
              className={cx(styles.item, isActive && styles.itemActive)}
              gap={10}
              justify={'flex-end'}
              key={id}
              onClick={() => onJump(virtuosoIndex)}
            >
              <span className={cx(styles.label, isActive && styles.labelActive)}>{label}</span>
              <div className={cx(styles.dash, isActive && styles.dashActive)} style={{ width }} />
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

MinimapPreview.displayName = 'MinimapPreview';
