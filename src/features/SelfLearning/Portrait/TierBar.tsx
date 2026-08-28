'use client';

import { memo } from 'react';

import type { TierCounts } from '../helpers';
import { portraitStyles as styles } from './styles';

/** 已养成 = 灰、有错 = 琥珀（老毛病实心、还不稳半透）、刚学 = 留白。 */
const TierBar = memo<{ counts: TierCounts; total: number }>(({ counts, total }) => {
  const denom = total || 1;
  const seg = (n: number, cls: string, key: string) =>
    n > 0 ? <div className={cls} key={key} style={{ width: `${(n / denom) * 100}%` }} /> : null;
  return (
    <div className={styles.bar}>
      {seg(counts.stable, styles.segOk, 'stable')}
      {seg(counts.shaky, styles.segShaky, 'shaky')}
      {seg(counts.recurring, styles.segBad, 'recurring')}
    </div>
  );
});

TierBar.displayName = 'ExpertiseTierBar';

export default TierBar;
