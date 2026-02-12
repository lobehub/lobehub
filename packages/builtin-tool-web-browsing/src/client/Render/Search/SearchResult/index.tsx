import type { SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { Block, Button, Empty, Flexbox, Icon, ScrollShadow, Skeleton } from '@lobehub/ui';
import { uniq } from 'es-toolkit/compat';
import { Edit2Icon, SearchIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/selectors';

import SearchResultItem from './SearchResultItem';
import ShowMore from './ShowMore';

const ITEM_HEIGHT = 80;
const ITEM_WIDTH = 160;

interface SearchResultProps {
  args: SearchQuery;
  editing: boolean;
  messageId: string;
  pluginState?: UniformSearchResponse;
  setEditing: (editing: boolean) => void;
}

const SearchResult = memo<SearchResultProps>(
  ({ messageId, args, pluginState, setEditing, editing }) => {
    const loading = useChatStore(chatToolSelectors.isSearXNGSearching(messageId));
    const searchResults = pluginState?.results || [];
    const { t } = useTranslation(['tool', 'common']);

    const engines = uniq(searchResults.flatMap((result) => result.engines));
    const defaultEngines = engines.length > 0 ? engines : args?.searchEngines || [];
    const isMobile = useIsMobile();

    if (loading || !pluginState)
      return (
        <Flexbox horizontal gap={8}>
          {['1', '2', '3', '4', '5'].map((id) => (
            <Skeleton.Block active height={ITEM_HEIGHT} key={id} width={ITEM_WIDTH} />
          ))}
        </Flexbox>
      );

    if (searchResults.length === 0)
      return (
        <Block variant={'outlined'}>
          <Empty description={t('search.emptyResult')} icon={SearchIcon}>
            {!editing && (
              <Button
                color={'default'}
                icon={<Icon icon={Edit2Icon} />}
                size={'small'}
                variant={'filled'}
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t('edit', { ns: 'common' })}
              </Button>
            )}
          </Empty>
        </Block>
      );

    return (
      <ScrollShadow
        horizontal
        gap={8}
        offset={8}
        orientation={'horizontal'}
        size={4}
        style={{ minHeight: ITEM_HEIGHT, paddingBottom: 8, width: '100%' }}
      >
        {searchResults.slice(0, 5).map((result) => (
          <SearchResultItem
            key={result.url}
            style={{ minWidth: ITEM_WIDTH, width: ITEM_WIDTH }}
            {...result}
          />
        ))}
        {!isMobile && searchResults.length > 5 && (
          <ShowMore
            engines={defaultEngines}
            messageId={messageId}
            resultsNumber={searchResults.length - 5}
            style={{ minWidth: ITEM_WIDTH }}
          />
        )}
      </ScrollShadow>
    );
  },
);

export default SearchResult;
