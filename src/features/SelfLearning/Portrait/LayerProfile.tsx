'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

import { countTiers, layerLabel, profileWord } from '../helpers';
import { portraitStyles as styles } from './styles';
import TierBar from './TierBar';

/** 「它在哪儿强、哪儿弱」—— 按领域自己的分层，一层一行。 */
const LayerProfile = memo<{ domain: ExpertiseDomainItem }>(({ domain }) => {
  const { t } = useTranslation('selfLearning');
  if (domain.layers.length === 0 || domain.lessons.length === 0) return null;

  return (
    <Block padding={0} variant={'outlined'}>
      <Flexbox>
        <Text className={styles.profileTitle} type={'secondary'}>
          {t('profile.title')}
        </Text>
        {domain.layers.map((layer, index) => {
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
            <div className={styles.profileRow} key={layer.key}>
              <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
                <Text className={styles.profileKey} fontSize={12} type={'secondary'}>
                  {layerLabel(index)}
                </Text>
                <Text
                  ellipsis
                  fontSize={14}
                  style={{ minWidth: 0 }}
                  title={layer.title}
                  weight={600}
                >
                  {layer.title}
                </Text>
              </Flexbox>
              <div className={styles.profileProgress}>
                <TierBar counts={counts} total={habits.length} />
              </div>
              <Text
                className={weak ? styles.accent : undefined}
                fontSize={13}
                type={weak ? undefined : 'secondary'}
                weight={weak ? 600 : undefined}
              >
                {t(`profile.word.${word}`)}
              </Text>
              <Text className={styles.profileCounts} fontSize={12.5} type={'secondary'}>
                {parts.join(' · ')}
              </Text>
            </div>
          );
        })}
      </Flexbox>
    </Block>
  );
});

LayerProfile.displayName = 'ExpertiseLayerProfile';

export default LayerProfile;
