import { Flexbox, Skeleton, Text } from '@lobehub/ui';

import { oneLineEllipsis } from '@/styles';

import { usePreviewFileItem } from './usePreviewFileItem';

const Title = () => {
  const { data, isLoading } = usePreviewFileItem();

  return (
    <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
      {/* Back and close live in the shared portal header — no second arrow here. */}
      {isLoading ? (
        <Skeleton height={28} />
      ) : (
        <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
          {data?.name}
        </Text>
      )}
    </Flexbox>
  );
};

export default Title;
