'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, keyframes } from 'antd-style';
import { DnaIcon, HistoryIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { useHistoryWarmup } from './useHistoryWarmup';

/** 从左往右填满再淡出、循环 —— 读起来是「在进行」，不会被读成「从右边开始的进度条」。 */
const fill = keyframes`
  0% { width: 0; opacity: 1; }
  80% { width: 100%; opacity: 1; }
  100% { width: 100%; opacity: 0; }
`;

const styles = createStaticStyles(({ css }) => ({
  track: css`
    position: relative;

    overflow: hidden;

    width: 160px;
    height: 6px;
    border-radius: 3px;

    background: ${cssVar.colorFillSecondary};

    &::after {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;

      border-radius: 3px;

      background: ${cssVar.colorSuccess};

      animation: ${fill} 1.8s ease-in-out infinite;
    }
  `,
}));

interface WarmupCardProps {
  candidateCount?: number;
  /** The directions this warm-up is for; several when the overview has more than one fresh one. */
  domainTitles: string[];
  warmup: ReturnType<typeof useHistoryWarmup>;
}

/**
 * 让它温习历史对话 —— 不是审批流：学到的立刻开始用，卡片只负责让「正在学」可感。
 * 单行布局：左边说明，右边动作 / 进度。后端不报进度，所以条是流动的，数字才是真实的。
 */
const WarmupCard = memo<WarmupCardProps>(({ candidateCount, domainTitles, warmup }) => {
  const { t } = useTranslation('selfLearning');
  // A history review reads every bound direction at once, so several fresh directions share
  // one card — name them instead of pretending the review is about only the first.
  const title =
    domainTitles.length > 1
      ? t('warmup.titleMulti', {
          count: domainTitles.length,
          names: domainTitles.join(t('warmup.namesSep')),
        })
      : t('warmup.title', { name: domainTitles[0] ?? '' });

  return (
    <Block padding={'12px 16px'} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <Flexbox gap={2} style={{ minWidth: 0 }}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon icon={DnaIcon} size={15} />
            <Text weight={600}>{title}</Text>
          </Flexbox>
          <Text fontSize={12.5} type={'secondary'}>
            {warmup.phase === 'idle' &&
              (candidateCount ? t('warmup.idle', { count: candidateCount }) : t('warmup.idleNone'))}
            {warmup.phase === 'running' &&
              t('warmup.running', { count: warmup.candidateCount, learned: warmup.learned })}
            {warmup.phase === 'done' && t('warmup.done', { learned: warmup.learned })}
          </Text>
        </Flexbox>

        <Flexbox horizontal align={'center'} gap={10} style={{ flex: 'none' }}>
          {warmup.phase === 'idle' && !!candidateCount && (
            <Button
              icon={HistoryIcon}
              loading={warmup.starting}
              type={'primary'}
              onClick={() => void warmup.start()}
            >
              {t('warmup.start', { count: candidateCount })}
            </Button>
          )}
          {warmup.phase === 'running' && <div className={styles.track} />}
          {warmup.phase === 'done' && (
            <Button onClick={warmup.dismiss}>{t('warmup.dismiss')}</Button>
          )}
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

WarmupCard.displayName = 'ExpertiseWarmupCard';

export default WarmupCard;
