import type { LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinPlaceholderProps } from '@lobechat/types';
import { Center, Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { SearchIcon } from 'lucide-react';
import React, { memo } from 'react';

const styles = stylex.create({
  query: {
    paddingBlock: '4px',
    paddingInline: '8px',
    borderRadius: '8px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    background: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
});

const SearchFiles = memo<BuiltinPlaceholderProps<LocalSearchFilesParams>>(({ args = {} }) => {
  return (
    <Flexbox gap={4}>
      <Flexbox horizontal align={'center'} distribution={'space-between'} gap={40} height={26}>
        <Flexbox
          horizontal
          align={'center'}
          className={stylex.props(styles.query).className}
          gap={8}
        >
          <Icon icon={SearchIcon} />
          {args.keywords ? args.keywords : <Skeleton height={20} width={40} />}
        </Flexbox>

        <Skeleton height={20} width={40} />
      </Flexbox>
      <Center height={140}>
        <Flexbox gap={4} width={'90%'}>
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} />
        </Flexbox>
      </Center>
    </Flexbox>
  );
});

export default SearchFiles;
