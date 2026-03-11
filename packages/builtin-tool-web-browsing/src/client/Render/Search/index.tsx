import type { BuiltinRenderProps, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { Alert, Flexbox, Highlighter } from '@lobehub/ui';
import { memo, useState } from 'react';

import ConfigForm from './ConfigForm';
import SearchQueryView from './SearchQuery';
import SearchResult from './SearchResult';

const Search = memo<BuiltinRenderProps<SearchQuery, UniformSearchResponse>>(
  ({ messageId, args: searchQuery, pluginState: searchResponse, pluginError }) => {
    const [editing, setEditing] = useState(false);

    if (pluginError) {
      if (pluginError?.type === 'PluginSettingsInvalid') {
        return <ConfigForm id={messageId} provider={pluginError.body?.provider} />;
      }

      return (
        <Alert
          title={pluginError?.message}
          type={'error'}
          extra={
            <Flexbox>
              <Highlighter actionIconSize={'small'} language={'json'} variant={'borderless'}>
                {JSON.stringify(pluginError.body?.data || pluginError.body, null, 2)}
              </Highlighter>
            </Flexbox>
          }
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
  },
);

export default Search;
