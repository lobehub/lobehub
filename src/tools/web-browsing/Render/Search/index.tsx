import { ChatMessagePluginError, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { Alert, Highlighter } from '@lobehub/ui';
import { memo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

import ConfigForm from './ConfigForm';
import SearchQueryView from './SearchQuery';
import SearchResult from './SearchResult';

interface SearchProps {
  messageId: string;
  pluginError: ChatMessagePluginError;
  searchQuery: SearchQuery;
  searchResponse?: UniformSearchResponse;
}

const Search = memo<SearchProps>(({ messageId, searchQuery, searchResponse, pluginError }) => {
  const [editing, setEditing] = useState(false);

  if (pluginError) {
    if (pluginError?.type === 'PluginSettingsInvalid') {
      return <ConfigForm id={messageId} provider={pluginError.body?.provider} />;
    }

    return (
      <Alert
        extra={
          <Flexbox>
            <Highlighter actionIconSize={'small'} language={'json'} variant={'borderless'}>
              {JSON.stringify(pluginError.body?.data || pluginError.body, null, 2)}
            </Highlighter>
          </Flexbox>
        }
        message={pluginError?.message}
        type={'error'}
      />
    );
  }

  return (
    <Flexbox gap={8}>
      <SearchQueryView
        args={searchQuery}
        editing={editing}
        messageId={messageId}
        pluginState={searchResponse}
        setEditing={setEditing}
      />
      <SearchResult
        args={searchQuery}
        editing={editing}
        messageId={messageId}
        pluginState={searchResponse}
        setEditing={setEditing}
      />
    </Flexbox>
  );
});

export default Search;
