'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';
import { StyleSheet } from '@/utils/styles';

import MaturityBadge from './MaturityBadge';

const styles = StyleSheet.create({
  active: {
    background: cssVar.colorFillSecondary,
  },
  item: {
    borderRadius: 8,
    cursor: 'pointer',
    paddingBlock: 10,
    paddingInline: 12,
  },
  rail: {
    borderInlineEnd: `1px solid ${cssVar.colorBorderSecondary}`,
    overflowY: 'auto',
  },
});

interface DomainRailProps {
  activeId?: string;
  domains: ExpertiseDomainItem[];
  onSelect: (id: string) => void;
}

/**
 * 专长列表。
 *
 * 一个 agent 挂多个专长是常态（workspace 挂的 + agent 自己挂的叠加），所以是常驻
 * 左栏而不是下拉：选哪个专长本身就是「它在往哪些方向长」的一览。
 */
const DomainRail = memo<DomainRailProps>(({ domains, activeId, onSelect }) => {
  const { t } = useTranslation('selfLearning');

  return (
    <Flexbox gap={2} padding={8} style={styles.rail} width={260}>
      {domains.map((domain) => (
        <Flexbox
          gap={6}
          key={domain.id}
          style={domain.id === activeId ? { ...styles.item, ...styles.active } : styles.item}
          onClick={() => onSelect(domain.id)}
        >
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Text ellipsis fontSize={13} weight={500}>
              {domain.title}
            </Text>
            {domain.anchorPending && <Tag>{t('anchor.tag')}</Tag>}
          </Flexbox>
          <MaturityBadge lessonCount={domain.lessonCount} maturity={domain.maturity} />
          <Text fontSize={12} type={'secondary'}>
            {t('summary.practices', { count: domain.runCount })}
          </Text>
        </Flexbox>
      ))}
    </Flexbox>
  );
});

DomainRail.displayName = 'DomainRail';

export default DomainRail;
