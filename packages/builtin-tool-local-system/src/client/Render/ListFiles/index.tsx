import { type LocalFileListState } from '@lobechat/builtin-tool-local-system';
import { type ListLocalFileParams } from '@lobechat/electron-client-ipc';
import { type BuiltinRenderProps } from '@lobechat/types';
import React, { memo } from 'react';

import { LocalFolder } from '@/features/LocalFile';

import SearchResult from './Result';

const ListFiles = memo<BuiltinRenderProps<ListLocalFileParams, LocalFileListState>>(
  ({ messageId, pluginError, args, pluginState }) => {
    return (
      <>
        <LocalFolder path={args.path} />
        <SearchResult
          listResults={pluginState?.listResults}
          messageId={messageId}
          pluginError={pluginError}
        />
      </>
    );
  },
);

ListFiles.displayName = 'ListFiles';

export default ListFiles;
