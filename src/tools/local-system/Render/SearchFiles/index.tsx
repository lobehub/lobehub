import { LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { LocalFileSearchState } from '@/tools/local-system/type';
import { ChatMessagePluginError } from '@/types/message';

import SearchResult from './Result';
import SearchQuery from './SearchQuery';

interface SearchFilesProps {
  args: LocalSearchFilesParams;
  messageId: string;
  pluginError: ChatMessagePluginError;
  pluginState?: LocalFileSearchState;
}

const SearchFiles = memo<SearchFilesProps>(({ messageId, pluginError, args, pluginState }) => {
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
});

SearchFiles.displayName = 'SearchFiles';

export default SearchFiles;
