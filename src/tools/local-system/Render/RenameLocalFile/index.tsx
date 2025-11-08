import { RenameLocalFileParams } from '@lobechat/electron-client-ipc';
import { ChatMessagePluginError } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ArrowRightIcon } from 'lucide-react';
import path from 'path-browserify-esm';
import React, { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { LocalFile } from '@/features/LocalFile';
import { LocalReadFileState } from '@/tools/local-system/type';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    color: ${token.colorTextQuaternary};
  `,
  new: css`
    color: ${token.colorTextSecondary};
  `,
}));

interface RenameLocalFileProps {
  args: RenameLocalFileParams;
  messageId: string;
  pluginError: ChatMessagePluginError;
  pluginState: LocalReadFileState;
}

const RenameLocalFile = memo<RenameLocalFileProps>(({ args }) => {
  const { styles } = useStyles();

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
});

export default RenameLocalFile;
