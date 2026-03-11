import type { LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinPlaceholderProps } from '@lobechat/types';
import { Center, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import React, { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  query: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: 8px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const SearchFiles = memo<BuiltinPlaceholderProps<LocalSearchFilesParams>>(({ args = {} }) => {
  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} distribution={'space-between'} gap={40} height={26}>
        <Flexbox horizontal align={'center'} className={styles.query} gap={8}>
          <Icon icon={SearchIcon} />
          {args.keywords ? (
            args.keywords
          ) : (
            <Skeleton.Block active style={{ height: 20, width: 40 }} />
          )}
        </Flexbox>

        <Skeleton.Block active style={{ height: 20, width: 40 }} />
      </Flexbox>
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

export default SearchFiles;
