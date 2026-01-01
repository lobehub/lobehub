import type { LocalReadFileState } from '@lobechat/builtin-tool-local-system';
import { type RenameLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRightIcon } from 'lucide-react';
import path from 'path-browserify-esm';
import React, { memo } from 'react';

import { LocalFile } from '@/features/LocalFile';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  new: css`
    color: ${cssVar.colorTextSecondary};
  `,
}));

const RenameLocalFile = memo<BuiltinRenderProps<RenameLocalFileParams, LocalReadFileState>>(
  ({ args }) => {
    const { base: oldFileName, dir } = path.parse(args.path);

    return (
      <Flexbox align={'center'} className={styles.container} gap={8} horizontal paddingInline={12}>
        <Flexbox>{oldFileName}</Flexbox>
        <Flexbox>
          <Icon icon={ArrowRightIcon} />
        </Flexbox>
        <LocalFile name={args.newName} path={path.join(dir, args.newName)} />
      </Flexbox>
    );
  },
);

export default RenameLocalFile;
