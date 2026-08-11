'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail } from '@/services/expertise';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    overflow: hidden;
    height: 6px;
    border-radius: 3px;
    background: ${cssVar.colorFillSecondary};
  `,
  fill: css`
    height: 100%;
    border-radius: 3px;
    background: ${cssVar.colorPrimary};
  `,
  /** 空层画一条虚线槽而不是空白 —— 空白会被读成「这一行还没加载出来」。 */
  gap: css`
    height: 6px;
    border: 1px dashed ${cssVar.colorWarningBorder};
    border-radius: 3px;
  `,
}));

interface LayerCoverageProps {
  detail: ExpertiseDomainDetail;
}

/**
 * 分层覆盖。
 *
 * 空层不是缺陷而是发现 —— 分层来自这个领域自己的经典模型，某一层一条规则都没有，
 * 说明这个 agent 一直没在那一层被考过。所以空层要显式画出来，不能因为 count=0 就消失。
 */
const LayerCoverage = memo<LayerCoverageProps>(({ detail }) => {
  const { t } = useTranslation('selfLearning');
  const { domain, layerCounts, unanchoredCount } = detail;
  const layers = domain.layers ?? [];
  const canonRefs = [...new Set(layers.map((l) => l.canonRef).filter(Boolean))];
  const max = Math.max(1, ...layers.map((l) => layerCounts[l.key] ?? 0));

  return (
    <Block gap={11} padding={16} variant={'outlined'}>
      <Flexbox gap={2}>
        <Text fontSize={13} weight={600}>
          {t('layers.title')}
        </Text>
        <Text fontSize={11} type={'secondary'}>
          {domain.layerSource === 'canonical'
            ? t('layers.fromCanon', { source: canonRefs.join(' · ') || '—' })
            : t('layers.invented')}
        </Text>
      </Flexbox>

      {layers.map((layer) => {
        const count = layerCounts[layer.key] ?? 0;
        return (
          <Flexbox gap={5} key={layer.key}>
            <Flexbox horizontal align={'center'} justify={'space-between'}>
              <Text fontSize={12.5}>{layer.title}</Text>
              <Text fontSize={11} type={count === 0 ? 'warning' : 'secondary'}>
                {count === 0 ? t('layers.blank') : t('layers.count', { count })}
              </Text>
            </Flexbox>
            {count === 0 ? (
              <div className={styles.gap} />
            ) : (
              <div className={styles.bar}>
                <div className={styles.fill} style={{ width: `${(count / max) * 100}%` }} />
              </div>
            )}
            {layer.description && (
              <Text fontSize={10.5} type={'secondary'}>
                {layer.description}
              </Text>
            )}
          </Flexbox>
        );
      })}

      <Block gap={5} padding={11} variant={'filled'}>
        <Text fontSize={12} weight={600}>
          {t('layers.noteTitle')}
        </Text>
        <Text fontSize={11} lineHeight={1.65} type={'secondary'}>
          {t('layers.noteBody')}
        </Text>
      </Block>

      {unanchoredCount > 0 && (
        <Text fontSize={11} type={'secondary'}>
          {t('layers.unanchored', { count: unanchoredCount })}
        </Text>
      )}
    </Block>
  );
});

LayerCoverage.displayName = 'LayerCoverage';

export default LayerCoverage;
