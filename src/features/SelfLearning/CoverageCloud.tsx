'use client';

import { Block, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainDetail } from '@/services/expertise';

const styles = createStaticStyles(({ css }) => ({
  empty: css`
    padding-block: 3px;
    padding-inline: 8px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: 999px;
  `,
  legendDot: css`
    width: 7px;
    height: 7px;
    border-radius: 999px;
  `,
  segment: css`
    min-width: 3px;
    height: 8px;

    &:first-child {
      border-start-start-radius: 6px;
      border-end-start-radius: 6px;
    }

    &:last-child {
      border-start-end-radius: 6px;
      border-end-end-radius: 6px;
    }
  `,
  track: css`
    overflow: hidden;
    display: flex;

    width: 100%;
    border-radius: 4px;

    background: ${cssVar.colorFillQuaternary};
  `,
}));

const OPACITIES = [0.35, 0.5, 0.65, 0.8, 1];

interface CoverageSnapshotProps {
  detail: ExpertiseDomainDetail;
}

/** A composition chart answers “where is the learning concentrated?”; empty layers stay explicit gaps. */
const CoverageSnapshot = memo<CoverageSnapshotProps>(({ detail }) => {
  const { t } = useTranslation('selfLearning');
  const { domain, layerCounts, lessonStats } = detail;

  const { covered, empty, total } = useMemo(() => {
    const layers = (domain.layers ?? []).map((layer, index) => ({
      count: layerCounts[layer.key] ?? 0,
      key: layer.key,
      opacity: OPACITIES[index % OPACITIES.length],
      title: layer.title,
    }));
    return {
      covered: layers.filter((layer) => layer.count > 0),
      empty: layers.filter((layer) => layer.count === 0),
      total: layers.reduce((sum, layer) => sum + layer.count, 0),
    };
  }, [domain.layers, layerCounts]);

  if (covered.length === 0 && empty.length === 0) return null;

  return (
    <Block gap={12} padding={16} variant={'outlined'}>
      <Flexbox horizontal align={'baseline'} justify={'space-between'} wrap={'wrap'}>
        <Text fontSize={13} weight={600}>
          {t('coverage.title')}
        </Text>
        <Text fontSize={11} type={'secondary'}>
          {t('coverage.sub', {
            covered: covered.length,
            total: covered.length + empty.length,
            unused: lessonStats.unused,
          })}
        </Text>
      </Flexbox>

      {total > 0 && (
        <Flexbox gap={10}>
          <div className={styles.track}>
            {covered.map((layer) => (
              <Tooltip
                key={layer.key}
                title={t('coverage.share', { count: layer.count, title: layer.title })}
              >
                <div
                  className={styles.segment}
                  style={{
                    background: cssVar.colorPrimary,
                    flex: layer.count,
                    opacity: layer.opacity,
                  }}
                />
              </Tooltip>
            ))}
          </div>
          <Flexbox horizontal gap={14} wrap={'wrap'}>
            {covered.map((layer) => (
              <Flexbox horizontal align={'center'} gap={6} key={layer.key}>
                <div
                  className={styles.legendDot}
                  style={{ background: cssVar.colorPrimary, opacity: layer.opacity }}
                />
                <Text fontSize={11.5}>{layer.title}</Text>
                <Text fontSize={11} type={'secondary'}>
                  {layer.count}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        </Flexbox>
      )}

      {empty.length > 0 && (
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Text fontSize={11} type={'secondary'}>
            {t('coverage.gaps')}
          </Text>
          {empty.map((layer) => (
            <div className={styles.empty} key={layer.key}>
              <Text fontSize={11.5} type={'secondary'}>
                {layer.title}
              </Text>
            </div>
          ))}
        </Flexbox>
      )}

      <Text fontSize={10.5} type={'secondary'}>
        {domain.layerSource === 'canonical'
          ? t('coverage.canon', {
              source:
                [
                  ...new Set((domain.layers ?? []).map((layer) => layer.canonRef).filter(Boolean)),
                ].join(' · ') || '—',
            })
          : t('coverage.invented')}
      </Text>
    </Block>
  );
});

CoverageSnapshot.displayName = 'CoverageSnapshot';

export default CoverageSnapshot;
