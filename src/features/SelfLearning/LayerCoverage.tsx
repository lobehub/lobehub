'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail } from '@/services/expertise';

/** 右侧那条进度的固定宽度。定宽才构成对比 —— 满行长条只能读出「有」和「没有」。 */
const TRACK = 88;

const styles = createStaticStyles(({ css }) => ({
  fill: css`
    height: 100%;
    border-radius: 2px;
    background: ${cssVar.colorTextTertiary};
  `,
  row: css`
    padding-block: 7px;
  `,
  track: css`
    overflow: hidden;

    width: ${TRACK}px;
    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillTertiary};
  `,
  /** 空层给一条虚线槽 —— 留白会被读成「这一行还没加载出来」。 */
  trackEmpty: css`
    width: ${TRACK}px;
    height: 4px;
    border: 1px dashed ${cssVar.colorWarningBorder};
    border-radius: 2px;
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
 *
 * 进度条定宽且靠右：验收原话是「线太重了，视觉强度太难受」。满行长条把每一层都画成
 * 一堵墙，而这个模块要读的是**层与层之间的落差**（收集 73 条 vs 交付 1 条）——
 * 定宽同起点的短条才让落差可比，也不至于盖过右边的规则库。
 */
const LayerCoverage = memo<LayerCoverageProps>(({ detail }) => {
  const { t } = useTranslation('selfLearning');
  const { domain, layerCounts, unanchoredCount } = detail;
  const layers = domain.layers ?? [];
  const canonRefs = [...new Set(layers.map((l) => l.canonRef).filter(Boolean))];
  const max = Math.max(1, ...layers.map((l) => layerCounts[l.key] ?? 0));

  return (
    <Block gap={10} padding={16} variant={'outlined'}>
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
          <Flexbox horizontal align={'center'} className={styles.row} gap={12} key={layer.key}>
            <Flexbox gap={1} style={{ flex: 1, minWidth: 0 }}>
              <Text ellipsis fontSize={12.5}>
                {layer.title}
              </Text>
              {layer.description && (
                <Text ellipsis fontSize={10.5} type={'secondary'}>
                  {layer.description}
                </Text>
              )}
            </Flexbox>
            {count === 0 ? (
              <div className={styles.trackEmpty} />
            ) : (
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${(count / max) * 100}%` }} />
              </div>
            )}
            <Text
              fontSize={11}
              style={{ flex: 'none', textAlign: 'right', width: 56 }}
              type={count === 0 ? 'warning' : 'secondary'}
            >
              {count === 0 ? t('layers.blank') : t('layers.count', { count })}
            </Text>
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
