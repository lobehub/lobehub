'use client';

import { Block, Flexbox, Tag, Text, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail } from '@/services/expertise';

interface LayerCoverageProps {
  detail: ExpertiseDomainDetail;
}

/**
 * 分层覆盖。
 *
 * 空层不是缺陷而是发现 —— 分层来自领域的经典模型，某一层一条规则都没有，说明
 * 这个 agent 一直没在那一层被考过。所以空层要显式画出来，不能因为 count=0 就消失。
 */
const LayerCoverage = memo<LayerCoverageProps>(({ detail }) => {
  const { t } = useTranslation('selfLearning');
  const { domain, layerCounts, unanchoredCount } = detail;
  const layers = domain.layers ?? [];
  // canonRef 挂在每一层上而不是领域上 —— 一套分层可能拼自两本经典，这里去重后一起报。
  const canonRefs = [...new Set(layers.map((l) => l.canonRef).filter(Boolean))];

  return (
    <Block gap={12} padding={20} variant={'outlined'}>
      <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
        <Text weight={600}>{t('layers.title')}</Text>
        <Text fontSize={12} type={'secondary'}>
          {domain.layerSource === 'canonical'
            ? t('layers.fromCanon', { source: canonRefs.join(' · ') || '—' })
            : t('layers.invented')}
        </Text>
      </Flexbox>
      <Flexbox gap={8}>
        {layers.map((layer) => {
          const count = layerCounts[layer.key] ?? 0;
          return (
            <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} key={layer.key}>
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text ellipsis fontSize={13}>
                  {layer.title}
                </Text>
                {layer.description && (
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {layer.description}
                  </Text>
                )}
              </Flexbox>
              {count > 0 ? (
                <Text fontSize={12} type={'secondary'}>
                  {t('layers.count', { count })}
                </Text>
              ) : (
                <Tooltip title={t('layers.blankDesc')}>
                  <Tag>{t('layers.blank')}</Tag>
                </Tooltip>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
      {unanchoredCount > 0 && (
        <Text fontSize={12} type={'secondary'}>
          {t('layers.unanchored', { count: unanchoredCount })}
        </Text>
      )}
    </Block>
  );
});

LayerCoverage.displayName = 'LayerCoverage';

export default LayerCoverage;
