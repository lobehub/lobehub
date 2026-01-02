'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MinimapIndicator } from './MinimapIndicator';
import { minimapStyles } from './styles';
import { useMinimapData } from './useMinimapData';
import { MIN_MESSAGES_THRESHOLD } from './utils';

const ChatMinimap = memo(() => {
  const { t } = useTranslation('chat');
  const styles = minimapStyles;
  const [isHovered, setIsHovered] = useState(false);

  const { indicators, activeIndicatorPosition, handleJump, handleStep } = useMinimapData();

  if (indicators.length <= MIN_MESSAGES_THRESHOLD) return null;

  return (
    <Flexbox align={'center'} className={styles.container} justify={'center'}>
      <Flexbox
        className={styles.rail}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        role={'group'}
      >
        <ActionIcon
          aria-label={t('minimap.previousMessage')}
          className={cx(styles.arrow, isHovered && styles.arrowVisible)}
          icon={ChevronUp}
          onClick={() => handleStep('prev')}
          size={14}
        />
        <Flexbox className={styles.railContent}>
          {indicators.map(({ id, width, preview, role, virtuosoIndex }, position) => (
            <MinimapIndicator
              activePosition={activeIndicatorPosition}
              id={id}
              key={id}
              onJump={handleJump}
              position={position}
              preview={preview}
              role={role}
              virtuosoIndex={virtuosoIndex}
              width={width}
            />
          ))}
        </Flexbox>
        <ActionIcon
          aria-label={t('minimap.nextMessage')}
          className={cx(styles.arrow, isHovered && styles.arrowVisible)}
          icon={ChevronDown}
          onClick={() => handleStep('next')}
          size={14}
        />
      </Flexbox>
    </Flexbox>
  );
});

ChatMinimap.displayName = 'ChatMinimap';

export default ChatMinimap;
