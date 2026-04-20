import type { SearchFilesState } from '@lobechat/tool-runtime';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import SearchResult from './Result';
import SearchQuery from './SearchQuery';

const SearchFiles = memo<BuiltinRenderProps<any, SearchFilesState>>(
  ({ messageId, pluginError, args, pluginState }) => {
    return (
      <Flexbox gap={4}>
        <SearchQuery args={args} messageId={messageId} pluginState={pluginState} />
        <SearchResult
          messageId={messageId}
          pluginError={pluginError}
          searchResults={pluginState?.results}
        />
      </Flexbox>
    );
  },
);

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
