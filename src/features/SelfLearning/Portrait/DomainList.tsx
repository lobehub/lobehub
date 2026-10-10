'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

import { countTiers } from '../helpers';
import { portraitStyles as styles } from './styles';
import TierBar from './TierBar';

interface DomainListProps {
  domains: ExpertiseDomainItem[];
  onOpen: (domainId: string) => void;
}

/** 多个方向时的方向清单：一根可靠度条 + 一个词。单方向时不渲染 —— 方向就是判断句的主语。 */
const DomainList = memo<DomainListProps>(({ domains, onOpen }) => {
  const { t } = useTranslation('selfLearning');
  return (
    <Flexbox gap={8}>
      <Text fontSize={12} type={'secondary'}>
        {t('domains.title')} {domains.length}
      </Text>
      <Block padding={0} variant={'outlined'}>
        {domains.map((d) => {
          const counts = countTiers(d.lessons);
          const word = counts.recurring
            ? t('domains.word.recurring', { count: counts.recurring })
            : counts.shaky
              ? t('domains.word.shaky', { count: counts.shaky })
              : d.lessons.length <= 3
                ? t('domains.word.fresh')
                : t('domains.word.stable');
          return (
            <Flexbox
              horizontal
              align={'center'}
              as={'button'}
              className={styles.row}
              gap={12}
              key={d.id}
              style={{
                background: 'transparent',
                color: 'inherit',
                textAlign: 'start',
                width: '100%',
              }}
              onClick={() => onOpen(d.id)}
            >
              <Text style={{ flex: 'none', width: 140 }} weight={500}>
                {d.title}
              </Text>
              <TierBar counts={counts} total={d.lessons.length} />
              <Text
                className={counts.recurring ? styles.accent : undefined}
                fontSize={12.5}
                style={{ flex: 1 }}
                type={counts.recurring ? undefined : 'secondary'}
              >
                {word}
              </Text>
              <Text fontSize={12} type={'secondary'}>
                {t('domains.meta', { habits: d.lessons.length, runs: d.runCount })}
              </Text>
              <Icon icon={ChevronRightIcon} size={13} style={{ flex: 'none', opacity: 0.4 }} />
            </Flexbox>
          );
        })}
      </Block>
    </Flexbox>
  );
});

DomainList.displayName = 'ExpertiseDomainList';

export default DomainList;
