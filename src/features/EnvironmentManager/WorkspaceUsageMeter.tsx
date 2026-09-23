'use client';

import { Flexbox, Tooltip } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatSize } from '@/utils/format';

import { useWorkspaceUsage } from './useEnvironmentData';

const styles = createStaticStyles(({ css }) => ({
  bar: css`
    overflow: hidden;

    width: 64px;
    height: 4px;
    border-radius: 2px;

    background: ${cssVar.colorFillSecondary};
  `,
  fill: css`
    height: 100%;
    border-radius: 2px;
  `,
}));

/**
 * How much of the workspace's storage the instances on this page occupy.
 *
 * On the page for exactly one reason: a workspace over its limit refuses
 * writes, and until now the only way to discover that was a save that failed.
 * The number is what was last measured rather than a fresh walk of the volume —
 * measuring stamps the workspace as active, so it belongs on the refresh button
 * beside this, not on every page load.
 *
 * Renders nothing without a workspace. Persistence is the paid boundary, and an
 * account that has none has no meter to read; the page's own upgrade prompt is
 * what speaks to that.
 */
const WorkspaceUsageMeter = memo(() => {
  const { t } = useTranslation('setting');
  const { data, error } = useWorkspaceUsage();

  if (error || !data) return null;

  const { quotaBytes, usageBytes, usageCheckedAt } = data;

  // Never measured. Saying "0 bytes" would be a claim we have not earned, and
  // on a workspace that has actually been written to it is the wrong one.
  if (usageBytes === null || usageBytes === undefined) {
    return (
      <Text fontSize={12} style={{ whiteSpace: 'nowrap' }} type={'secondary'}>
        {t('environments.storage.unmeasured', { total: formatSize(quotaBytes) })}
      </Text>
    );
  }

  const ratio = quotaBytes > 0 ? usageBytes / quotaBytes : 0;
  const over = usageBytes > quotaBytes;

  const label = (
    <Flexbox horizontal align={'center'} gap={6} style={{ flex: 'none' }}>
      <div className={styles.bar}>
        <div
          className={styles.fill}
          style={{
            background: over ? cssVar.colorError : cssVar.colorTextTertiary,
            // Capped, so an over-quota workspace still draws a full bar rather
            // than overflowing its track.
            width: `${Math.min(100, Math.max(ratio * 100, usageBytes > 0 ? 2 : 0))}%`,
          }}
        />
      </div>
      <Text
        fontSize={12}
        style={{ whiteSpace: 'nowrap' }}
        type={over ? 'danger' : 'secondary'}
        weight={500}
      >
        {t('environments.storage.used', {
          total: formatSize(quotaBytes),
          used: formatSize(usageBytes),
        })}
      </Text>
    </Flexbox>
  );

  return (
    <Tooltip
      title={
        over
          ? t('environments.storage.over')
          : usageCheckedAt
            ? t('environments.storage.measuredAt', {
                time: new Date(usageCheckedAt).toLocaleString(),
              })
            : undefined
      }
    >
      {label}
    </Tooltip>
  );
});

WorkspaceUsageMeter.displayName = 'WorkspaceUsageMeter';

export default WorkspaceUsageMeter;
