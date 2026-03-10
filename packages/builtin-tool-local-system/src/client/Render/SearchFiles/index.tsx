import type { LocalFileSearchState } from '@lobechat/builtin-tool-local-system';
import type { LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SearchResult from './Result';
import SearchQuery from './SearchQuery';

const SearchFiles = memo<BuiltinRenderProps<LocalSearchFilesParams, LocalFileSearchState>>(
  ({ messageId, pluginError, args, pluginState }) => {
    return (
      <Flexbox gap={4}>
        <SearchQuery args={args} messageId={messageId} pluginState={pluginState} />
        <SearchResult
          messageId={messageId}
          pluginError={pluginError}
          searchResults={pluginState?.searchResults}
        />
      </Flexbox>
    );
  },
);

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
