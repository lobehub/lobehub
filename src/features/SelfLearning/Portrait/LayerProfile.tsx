'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

import { countTiers, profileWord } from '../helpers';
import { portraitStyles as styles } from './styles';
import TierBar from './TierBar';

/** 「它在哪儿强、哪儿弱」—— 按领域自己的分层，一层一行。 */
const LayerProfile = memo<{ domain: ExpertiseDomainItem }>(({ domain }) => {
  const { t } = useTranslation('selfLearning');
  if (domain.layers.length === 0 || domain.lessons.length === 0) return null;

  return (
    <Block padding={'10px 14px'} variant={'outlined'}>
      <Flexbox gap={8}>
        <Text fontSize={12} type={'secondary'}>
          {t('profile.title')}
        </Text>
        {domain.layers.map((layer) => {
          const habits = domain.lessons.filter((l) => l.layer === layer.key);
          const counts = countTiers(habits);
          const word = profileWord(counts, habits.length);
          const weak = word === 'weak';
          const parts = [
            t('profile.counts', { count: habits.length }),
            counts.recurring ? t('profile.recurring', { count: counts.recurring }) : null,
            counts.shaky ? t('profile.shaky', { count: counts.shaky }) : null,
            counts.fresh ? t('profile.fresh', { count: counts.fresh }) : null,
          ].filter(Boolean);
          return (
            <Flexbox horizontal align={'center'} gap={12} key={layer.key}>
              <Text fontSize={13} style={{ flex: 'none', width: 96 }} weight={500}>
                {layer.title}
              </Text>
              <TierBar counts={counts} total={habits.length} />
              <Text
                className={weak ? styles.accent : undefined}
                fontSize={12.5}
                type={weak ? undefined : 'secondary'}
                weight={weak ? 600 : undefined}
              >
                {t(`profile.word.${word}`)}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {parts.join(' · ')}
              </Text>
            </Flexbox>
          );
        })}
      </Flexbox>
    </Block>
  );
});

LayerProfile.displayName = 'ExpertiseLayerProfile';

export default LayerProfile;
