import { ListLocalFileParams } from '@lobechat/electron-client-ipc';
import { Skeleton } from 'antd';
import React, { memo } from 'react';
import { Center, Flexbox } from 'react-layout-kit';

import { LocalFolder } from '@/features/LocalFile';

interface ListFilesProps {
  args: ListLocalFileParams;
}
export const ListFiles = memo<ListFilesProps>(({ args }) => {
  return (
    <Flexbox gap={12}>
      <LocalFolder path={args.path} />
      <Center height={140}>
        <Flexbox gap={4} width={'90%'}>
          <Skeleton.Button active block style={{ height: 16 }} />
          <Skeleton.Button active block style={{ height: 16 }} />
          <Skeleton.Button active block style={{ height: 16 }} />
          <Skeleton.Button active block style={{ height: 16 }} />
        </Flexbox>
      </Center>
    </Flexbox>
  );
});
