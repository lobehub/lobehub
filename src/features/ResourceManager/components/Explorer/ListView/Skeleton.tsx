import { Flexbox, Skeleton } from '@lobehub/ui';

import { FILE_DATE_WIDTH, FILE_SIZE_WIDTH } from './ListItem';

const ListViewSkeleton = () => (
  <Flexbox style={{ marginInline: 16 }}>
    {Array.from({ length: 4 }).map((_, index) => (
      <Flexbox align={'center'} distribution={'space-between'} height={48} horizontal key={index}>
        <Flexbox align={'center'} flex={1} gap={8} horizontal paddingInline={8}>
          <Skeleton.Avatar active shape={'square'} size={24} style={{ marginInline: 8 }} />
          <Skeleton.Button active style={{ height: 16, width: 300 }} />
        </Flexbox>
        <Flexbox paddingInline={24} width={FILE_DATE_WIDTH}>
          <Skeleton.Button active style={{ height: 16 }} />
        </Flexbox>
        <Flexbox paddingInline={24} width={FILE_SIZE_WIDTH}>
          <Skeleton.Button active style={{ height: 16 }} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);

export default ListViewSkeleton;
