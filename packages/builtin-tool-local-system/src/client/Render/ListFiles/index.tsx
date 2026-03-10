import type { LocalFileListState } from '@lobechat/builtin-tool-local-system';
import type { ListLocalFileParams } from '@lobechat/electron-client-ipc';
import type { BuiltinRenderProps } from '@lobechat/types';
import React, { memo } from 'react';

import SearchResult from './Result';

const ListFiles = memo<BuiltinRenderProps<ListLocalFileParams, LocalFileListState>>(
  ({ messageId, pluginError, pluginState }) => {
    return (
      <SearchResult
        listResults={pluginState?.listResults}
        messageId={messageId}
        pluginError={pluginError}
      />
    );
  },
);

ListFiles.displayName = 'ListFiles';

export default ListFiles;
