'use client';

import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui/base-ui';

import EvalPage from '@/features/Eval/components/EvalPage';

/** Page-shaped loading state: identity, the stat row, then two list sections. */
const ExperimentSkeleton = () => (
  <EvalPage
    header={
      <Flexbox horizontal gap={12}>
        <Skeleton height={40} radius={8} width={40} />
        <Flexbox gap={8}>
          <Skeleton height={24} width={240} />
          <Skeleton height={14} width={180} />
        </Flexbox>
      </Flexbox>
    }
  >
    <Flexbox horizontal gap={12}>
      {[0, 1, 2].map((i) => (
        <Skeleton height={72} key={i} radius={8} style={{ flex: 1 }} />
      ))}
    </Flexbox>
    {[0, 1].map((i) => (
      <Flexbox gap={12} key={i}>
        <Skeleton height={20} width={140} />
        <Skeleton height={120} radius={8} />
      </Flexbox>
    ))}
  </EvalPage>
);

export default ExperimentSkeleton;
