import { ListLocalFileParams } from '@lobechat/electron-client-ipc';
import { ChatMessagePluginError } from '@lobechat/types';
import React, { memo } from 'react';

import { LocalFolder } from '@/features/LocalFile';
import { LocalFileListState } from '@/tools/local-system/type';

import SearchResult from './Result';

interface ListFilesProps {
  args: ListLocalFileParams;
  messageId: string;
  pluginError: ChatMessagePluginError;
  pluginState?: LocalFileListState;
}

const ListFiles = memo<ListFilesProps>(({ messageId, pluginError, args, pluginState }) => {
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
});

ListFiles.displayName = 'ListFiles';

export default ListFiles;
