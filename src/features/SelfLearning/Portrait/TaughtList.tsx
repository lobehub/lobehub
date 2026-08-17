'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseHabit } from '@/services/expertise';

import { habitTier } from '../helpers';
import { portraitStyles as styles } from './styles';

/**
 * 教学的回响：你教过的每一件事，现在怎么样了。
 * 「用上了」这一档要等注入回路才会真的发生 —— 在那之前它只会停在「还没机会用」。
 */
const TaughtList = memo<{ habits: ExpertiseHabit[] }>(({ habits }) => {
  const { t } = useTranslation('selfLearning');
  const taught = habits.filter((h) => h.taughtByUser);
  if (taught.length === 0) return null;

  return (
    <Block padding={'10px 14px'} variant={'outlined'}>
      <Flexbox gap={6}>
        <Text fontSize={12} type={'secondary'}>
          {t('taught.title', { count: taught.length })}
        </Text>
        {taught.map((h) => {
          const tier = habitTier(h.recent);
          const arc =
            tier === 'recurring'
              ? 'recurring'
              : tier === 'shaky'
                ? 'shaky'
                : h.recent.length > 0
                  ? 'used'
                  : 'pending';
          const bad = arc === 'recurring' || arc === 'shaky';
          return (
            <Flexbox horizontal align={'center'} gap={10} key={h.id}>
              <Text fontSize={12} style={{ flex: 'none', width: 64 }} type={'secondary'}>
                {dayjs(h.createdAt).fromNow()}
              </Text>
              <Text ellipsis fontSize={13} style={{ flex: 1 }}>
                {h.title}
              </Text>
              <Text
                className={bad ? styles.accent : undefined}
                fontSize={12.5}
                type={bad ? undefined : 'secondary'}
                weight={bad ? 600 : undefined}
              >
                {t(`taught.arc.${arc}`)}
              </Text>
            </Flexbox>
          );
        })}
      </Flexbox>
    </Block>
  );
});

TaughtList.displayName = 'ExpertiseTaughtList';

export default TaughtList;
