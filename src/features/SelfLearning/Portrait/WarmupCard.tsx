'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, keyframes } from 'antd-style';
import { GraduationCapIcon, HistoryIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { useHistoryWarmup } from './useHistoryWarmup';

const slide = keyframes`
  from { transform: translateX(-100%); }
  to { transform: translateX(300%); }
`;

const styles = createStaticStyles(({ css }) => ({
  track: css`
    position: relative;

    overflow: hidden;
    flex: 1;

    height: 6px;
    border-radius: 3px;

    background: ${cssVar.colorFillSecondary};

    &::after {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;

      width: 33%;
      border-radius: 3px;

      background: ${cssVar.colorSuccess};

      animation: ${slide} 1.6s ease-in-out infinite;
    }
  `,
}));

interface WarmupCardProps {
  candidateCount?: number;
  domainTitle: string;
  warmup: ReturnType<typeof useHistoryWarmup>;
}

/**
 * 让它温习历史对话 —— 不是审批流：学到的立刻开始用，卡片只负责让「正在学」可感。
 * 后端不报进度，所以进度条是流动的，数字才是真实的（新经验一条条进来）。
 */
const WarmupCard = memo<WarmupCardProps>(({ candidateCount, domainTitle, warmup }) => {
  const { t } = useTranslation('selfLearning');

  return (
    <Block padding={16} variant={'outlined'}>
      <Flexbox gap={10}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={GraduationCapIcon} size={16} />
          <Text weight={600}>{t('warmup.title', { name: domainTitle })}</Text>
        </Flexbox>

        {warmup.phase === 'idle' && (
          <>
            <Text type={'secondary'}>
              {candidateCount ? t('warmup.idle', { count: candidateCount }) : t('warmup.idleNone')}
            </Text>
            {!!candidateCount && (
              <Flexbox horizontal>
                <Button
                  icon={HistoryIcon}
                  loading={warmup.starting}
                  type={'primary'}
                  onClick={() => void warmup.start()}
                >
                  {t('warmup.start', { count: candidateCount })}
                </Button>
              </Flexbox>
            )}
          </>
        )}

        {warmup.phase === 'running' && (
          <Flexbox horizontal align={'center'} gap={12}>
            <div className={styles.track} />
            <Text fontSize={12.5} style={{ flex: 'none' }} type={'secondary'}>
              {t('warmup.running', { count: warmup.candidateCount, learned: warmup.learned })}
            </Text>
          </Flexbox>
        )}

        {warmup.phase === 'done' && (
          <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
            <Text fontSize={13}>{t('warmup.done', { learned: warmup.learned })}</Text>
            <Button size={'small'} onClick={warmup.dismiss}>
              {t('warmup.dismiss')}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Block>
  );
});

WarmupCard.displayName = 'ExpertiseWarmupCard';

export default WarmupCard;
