'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton, SkeletonText } from '@lobehub/ui/base-ui';

import EvalPage from '@/features/Eval/components/EvalPage';

import { styles } from './style';

/** Rows shaped like the case list: index, two-line input, status chips. */
export const CaseListSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <div className={styles.list}>
    {Array.from({ length: rows }, (_, i) => (
      <Flexbox horizontal className={styles.caseRow} gap={12} key={i} style={{ cursor: 'default' }}>
        <Skeleton height={14} width={20} />
        <Flexbox flex={1} gap={8}>
          <SkeletonText rows={2} width={['90%', '60%']} />
          <Flexbox horizontal gap={12}>
            <Skeleton height={20} radius={4} width={72} />
            <Skeleton height={14} width={64} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    ))}
  </div>
);

/** Page-shaped loading state: breadcrumb, identity, meta, then the case list. */
const DatasetSkeleton = () => (
  <EvalPage
    header={
      <Flexbox gap={12}>
        <Skeleton height={14} width={160} />
        <Flexbox horizontal align="flex-start" gap={12} justify="space-between">
          <Flexbox horizontal gap={12}>
            <Skeleton height={40} radius={8} width={40} />
            <Flexbox gap={8}>
              <Skeleton height={24} width={240} />
              <Skeleton height={14} width={180} />
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            <Skeleton height={32} width={88} />
            <Skeleton height={32} width={120} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
    }
  >
    <Flexbox gap={12}>
      <Skeleton height={20} width={120} />
      <CaseListSkeleton />
    </Flexbox>
  </EvalPage>
);

export default DatasetSkeleton;
