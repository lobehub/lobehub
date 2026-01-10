import { Center, Checkbox, Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';

import { FILE_DATE_WIDTH, FILE_SIZE_WIDTH } from './ListItem';

interface ListViewSkeletonProps {
  columnWidths?: {
    date: number;
    name: number;
    size: number;
  };
  count?: number;
}

const ListViewSkeleton = ({
  columnWidths = { date: FILE_DATE_WIDTH, name: 400, size: FILE_SIZE_WIDTH },
  count = 6,
}: ListViewSkeletonProps) => {
  // Calculate opacity gradient from 100% to 20%
  const getOpacity = (index: number) => 1 - (index / (count - 1)) * 0.8;

  return (
    <Flexbox>
      {Array.from({ length: count }).map((_, index) => (
        <Flexbox
          align={'center'}
          height={48}
          horizontal
          key={index}
          paddingInline={8}
          style={{
            borderBlockEnd: `1px solid ${cssVar.colorBorderSecondary}`,
            opacity: getOpacity(index),
          }}
        >
        <Center height={40} style={{ paddingInline: 4 }}>
          <Checkbox disabled />
        </Center>
        <Flexbox
          align={'center'}
          horizontal
          paddingInline={8}
          style={{
            flexShrink: 0,
            maxWidth: columnWidths.name,
            minWidth: columnWidths.name,
            width: columnWidths.name,
          }}
        >
          <Skeleton.Avatar active shape={'square'} size={24} style={{ marginInline: 8 }} />
          <Skeleton.Button active style={{ height: 16, width: '60%' }} />
        </Flexbox>
        <Flexbox paddingInline={24} style={{ flexShrink: 0 }} width={columnWidths.date}>
          <Skeleton.Button active style={{ height: 16, width: '80%' }} />
        </Flexbox>
        <Flexbox paddingInline={24} style={{ flexShrink: 0 }} width={columnWidths.size}>
          <Skeleton.Button active style={{ height: 16, width: '60%' }} />
        </Flexbox>
      </Flexbox>
    ))}
  </Flexbox>
);
};

export default ListViewSkeleton;
