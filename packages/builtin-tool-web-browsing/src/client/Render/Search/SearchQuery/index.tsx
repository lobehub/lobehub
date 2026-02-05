import type { SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { ActionIcon } from '@lobehub/ui';
import { uniq } from 'es-toolkit/compat';
import { XIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/selectors';

import SearchBar from '../../../components/SearchBar';
import SearchView from './SearchView';

interface SearchQueryViewProps {
  args: SearchQuery;
  editing: boolean;
  messageId: string;
  pluginState?: UniformSearchResponse;
  setEditing: (editing: boolean) => void;
}

const SearchQueryView = memo<SearchQueryViewProps>(
  ({ messageId, args, pluginState, setEditing, editing }) => {
    const loading = useChatStore(chatToolSelectors.isSearXNGSearching(messageId));
    const searchResults = pluginState?.results || [];

    const { t } = useTranslation('common');

    const engines = uniq(searchResults.flatMap((result) => result.engines));
    const defaultEngines = engines.length > 0 ? engines : args.searchEngines || [];

    return editing ? (
      <SearchBar
        defaultEngines={defaultEngines}
        defaultQuery={args?.query}
        messageId={messageId}
        searchAddon={
          <ActionIcon
            icon={XIcon}
            title={t('cancel')}
            variant={'outlined'}
            onClick={() => setEditing(false)}
          />
        }
        onSearch={() => setEditing(false)}
      />
    ) : (
      <SearchView
        defaultEngines={defaultEngines}
        defaultQuery={args?.query}
        resultsNumber={searchResults.length}
        searching={loading || !pluginState}
        onEditingChange={setEditing}
      />
    );
  },
);

export default SearchQueryView;
