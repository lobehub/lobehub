import { Block, Popover, Text } from '@lobehub/ui';
import { cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { indicatorStyles } from './styles';
import { type MinimapIndicatorProps } from './types';

export const MinimapIndicator = memo<MinimapIndicatorProps>(
  ({ id, width, preview, role, virtuosoIndex, position, activePosition, onJump }) => {
    const { t } = useTranslation('chat');
    const styles = indicatorStyles;

    const isActive = activePosition === position;
    const senderLabel = role === 'user' ? t('minimap.senderUser') : t('minimap.senderAssistant');

    const popoverContent = preview ? (
      <>
        <Text fontSize={12} style={{ marginBottom: 4 }} type={'secondary'} weight={500}>
          {senderLabel}
        </Text>
        <Text as={'p'} fontSize={12}>
          {preview}
        </Text>
      </>
    ) : undefined;

    return (
      <Popover
        content={popoverContent}
        key={id}
        mouseEnterDelay={0.1}
        placement={'left'}
        styles={{
          content: {
            width: 320,
          },
        }}
      >
        <Block
          clickable
          align={'flex-end'}
          style={{ borderRadius: 4 }}
          variant={'borderless'}
          width={'100%'}
        >
          <div
            aria-current={isActive ? 'true' : undefined}
            aria-label={t('minimap.jumpToMessage', { index: position + 1 })}
            className={styles.indicator}
            style={{ width }}
            onClick={() => onJump(virtuosoIndex)}
          >
            <div
              className={cx(styles.indicatorContent, isActive && styles.indicatorContentActive)}
            />
          </div>
        </Block>
      </Popover>
    );
  },
);

MinimapIndicator.displayName = 'MinimapIndicator';
