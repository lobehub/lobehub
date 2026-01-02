import { type WriteLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { ChevronRight } from 'lucide-react';
import path from 'path-browserify-esm';
import { memo } from 'react';

import { LocalFile, LocalFolder } from '@/features/LocalFile';

const WriteFile = memo<BuiltinRenderProps<WriteLocalFileParams>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const { base, dir } = path.parse(args.path);

  return (
    <Flexbox horizontal>
      <LocalFolder path={dir} />
      <Icon icon={ChevronRight} />
      <LocalFile name={base} path={args.path} />
    </Flexbox>
  );
});

export default WriteFile;
