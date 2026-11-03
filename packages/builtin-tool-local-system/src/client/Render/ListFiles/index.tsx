import type { ListFilesState } from '@lobechat/tool-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import SearchResult from './Result';

const ListFiles = memo<BuiltinRenderProps<any, ListFilesState>>(
  ({ messageId, pluginError, pluginState }) => {
    return (
      <SearchResult
        listResults={pluginState?.files}
        messageId={messageId}
        pluginError={pluginError}
      />
    );
  },
);

ListFiles.displayName = 'ListFiles';

export default ListFiles;
