import type { LocalFileSearchState } from '@lobechat/builtin-tool-local-system';
import type { LocalSearchFilesParams } from '@lobechat/electron-client-ipc';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/selectors';

import SearchView from './SearchView';

interface SearchQueryViewProps {
  args: LocalSearchFilesParams;
  messageId: string;
  pluginState?: LocalFileSearchState;
}

const SearchQueryView = memo<SearchQueryViewProps>(({ messageId, args, pluginState }) => {
  const loading = useChatStore(chatToolSelectors.isSearchingLocalFiles(messageId));
  const searchResults = pluginState?.searchResults || [];

  return (
    <SearchView
      defaultQuery={args?.keywords}
      resultsNumber={searchResults.length}
      searching={loading || !pluginState}
    />
  );
});

export default SearchQueryView;
