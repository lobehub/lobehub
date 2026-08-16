'use client';

import { Block, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, useTheme } from 'antd-style';
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
  pie: css`
    flex: none;
    width: 104px;
    height: 104px;
    border-radius: 50%;
  `,
}));

interface CoverageSnapshotProps {
  detail: ExpertiseDomainDetail;
}

/** A composition chart answers “where is the learning concentrated?”; empty layers stay explicit gaps. */
const CoverageSnapshot = memo<CoverageSnapshotProps>(({ detail }) => {
  const { t } = useTranslation('selfLearning');
  const theme = useTheme();
  const { domain, layerCounts, lessonStats } = detail;

  const { covered, empty, total } = useMemo(() => {
    const layers = (domain.layers ?? []).map((layer) => ({
      count: layerCounts[layer.key] ?? 0,
      key: layer.key,
      title: layer.title,
    }));
    return {
      covered: layers.filter((layer) => layer.count > 0),
      empty: layers.filter((layer) => layer.count === 0),
      total: layers.reduce((sum, layer) => sum + layer.count, 0),
    };
  }, [domain.layers, layerCounts]);

  if (covered.length === 0 && empty.length === 0) return null;

  const colors = [theme.blue6, theme.cyan6, theme.green6, theme.gold6, theme.magenta6];
  let cursor = 0;
  const pie = covered
    .map((layer, index) => {
      const start = cursor;
      cursor += (layer.count / total) * 100;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    })
    .join(', ');

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
        <Flexbox horizontal align={'center'} gap={24}>
          <Tooltip title={t('coverage.total', { count: total })}>
            <div className={styles.pie} style={{ background: `conic-gradient(${pie})` }} />
          </Tooltip>
          <Flexbox gap={8}>
            {covered.map((layer) => (
              <Flexbox horizontal align={'center'} gap={6} key={layer.key}>
                <div
                  className={styles.legendDot}
                  style={{ background: colors[covered.indexOf(layer) % colors.length] }}
                />
                <Text fontSize={11.5}>{layer.title}</Text>
                <Text fontSize={11} type={'secondary'}>
                  {layer.count} · {Math.round((layer.count / total) * 100)}%
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
