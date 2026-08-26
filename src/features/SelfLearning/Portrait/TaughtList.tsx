'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import dayjs from 'dayjs';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseHabit } from '@/services/expertise';

import { habitTier } from '../helpers';
import { portraitStyles as styles } from './styles';

/** The card is a glance, not a ledger: only the latest few teachings stay open by default. */
const VISIBLE_LIMIT = 5;

/**
 * 教学的回响：你教过的每一件事，现在怎么样了。
 * 「用上了」这一档要等注入回路才会真的发生 —— 在那之前它只会停在「还没机会用」。
 * 教得多了也只露最近几条 —— 完整清单在下面的习惯列表里，这里不重复。
 */
const TaughtList = memo<{ habits: ExpertiseHabit[] }>(({ habits }) => {
  const { t } = useTranslation('selfLearning');
  const [expanded, setExpanded] = useState(false);
  const taught = useMemo(
    () =>
      habits
        .filter((h) => h.taughtByUser)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [habits],
  );
  if (taught.length === 0) return null;
  const visible = expanded ? taught : taught.slice(0, VISIBLE_LIMIT);
  const hidden = taught.length - visible.length;

  return (
    <Block padding={'14px 16px'} variant={'outlined'}>
      <Flexbox gap={4}>
        <Text fontSize={12} style={{ marginBlockEnd: 6 }} type={'secondary'}>
          {t('taught.title', { count: taught.length })}
        </Text>
        {visible.map((h) => {
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
            <Flexbox
              horizontal
              align={'center'}
              gap={12}
              key={h.id}
              style={{ minHeight: 30, paddingBlock: 2 }}
            >
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
        {hidden > 0 && (
          <Flexbox horizontal justify={'center'} style={{ marginBlockStart: 4 }}>
            <Button size={'small'} type={'text'} onClick={() => setExpanded(true)}>
              {t('taught.showAll', { count: taught.length })}
            </Button>
          </Flexbox>
        )}
      </Flexbox>
    </Block>
  );
});

TaughtList.displayName = 'ExpertiseTaughtList';

export default TaughtList;
