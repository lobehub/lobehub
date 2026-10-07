import { Flexbox } from '@lobehub/ui';
import { Skeleton, SkeletonText } from '@lobehub/ui/base-ui';

import { datasetRowStyles } from './DatasetRow';

/** Shaped like the dataset list: icon, name + description, count, action. */
const DatasetsSkeleton = () => (
  <div className={datasetRowStyles.list}>
    {[0, 1, 2].map((i) => (
      <div className={datasetRowStyles.row} key={i}>
        <Skeleton height={32} width={32} />
        <Flexbox flex={1} gap={6}>
          <SkeletonText width={160} />
          <SkeletonText width={240} />
        </Flexbox>
        <SkeletonText width={56} />
        <Skeleton height={24} width={64} />
      </div>
    ))}
  </div>
);

export default DatasetsSkeleton;
