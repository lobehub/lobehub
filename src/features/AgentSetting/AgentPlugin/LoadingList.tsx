import { Flexbox, Skeleton } from '@lobehub/ui';

const LoadingList = () => {
  const loadingItem = {
    avatar: <Skeleton.Avatar active shape="square" size={40} style={{ flex: 'none' }} />,
    label: (
      <Flexbox flex={1} gap={6} style={{ overflow: 'hidden' }}>
        <Skeleton.Button
          active
          size={'small'}
          style={{
            height: 16,
            width: '70%',
          }}
        />
        <Skeleton.Button
          active
          size={'small'}
          style={{
            height: 12,
            width: '50%',
          }}
        />
      </Flexbox>
    ),
  };

  return [loadingItem, loadingItem, loadingItem];
};

export default LoadingList;
