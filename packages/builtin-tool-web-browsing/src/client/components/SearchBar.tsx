import type { SearchQuery } from '@lobechat/types';
import {
  Block,
  Checkbox,
  Flexbox,
  SearchBar as Search,
  Segmented,
  Select,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/selectors';

import { CATEGORY_ICON_MAP, ENGINE_ICON_MAP } from '../../const';
import { CategoryAvatar } from './CategoryAvatar';
import { EngineAvatar } from './EngineAvatar';

const styles = createStaticStyles(({ css }) => ({
  textHeader: css`
    flex: none;
    width: 120px;
  `,
}));

interface SearchBarProps {
  aiSummary?: boolean;
  defaultCategories?: string[];
  defaultEngines?: string[];
  defaultQuery: string;
  defaultTimeRange?: string;
  messageId: string;
  onSearch?: (searchQuery: SearchQuery) => void;
  searchAddon?: ReactNode;
  tooltip?: boolean;
}

const SearchBar = memo<SearchBarProps>(
  ({
    defaultCategories = [],
    defaultEngines = [],
    defaultTimeRange,
    aiSummary = true,
    defaultQuery,
    tooltip = true,
    searchAddon,
    onSearch,
    messageId,
  }) => {
    const { t } = useTranslation('tool');
    const loading = useChatStore(chatToolSelectors.isSearXNGSearching(messageId));
    const [query, setQuery] = useState(defaultQuery);
    const [categories, setCategories] = useState(defaultCategories);
    const [engines, setEngines] = useState(defaultEngines);
    const [time_range, setTimeRange] = useState(defaultTimeRange);
    const isMobile = useIsMobile();
    const [reSearchWithSearXNG] = useChatStore((s) => [s.triggerSearchAgain]);

    const updateAndSearch = async () => {
      const data: SearchQuery = {
        query,
        searchCategories: categories,
        searchEngines: engines,
        searchTimeRange: time_range,
      };
      onSearch?.(data);
      await reSearchWithSearXNG(messageId, data);
    };

    const searchComponent = (
      <Search
        autoFocus
        loading={loading}
        placeholder={t('search.searchBar.placeholder')}
        style={{ minWidth: isMobile ? undefined : 400, width: '100%' }}
        value={query}
        onSearch={updateAndSearch}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
      />
    );

    return (
      <>
        <Flexbox horizontal align={'center'} flex={1} gap={8} height={32} justify={'space-between'}>
          {tooltip ? (
            <Tooltip title={t('search.searchBar.tooltip')}>{searchComponent}</Tooltip>
          ) : (
            searchComponent
          )}
          {searchAddon}
        </Flexbox>
        <Block gap={24} padding={12} variant={'outlined'}>
          {isMobile ? (
            <Select
              mode={'multiple'}
              placeholder={t('search.searchEngine.placeholder')}
              size={'small'}
              value={engines}
              variant={'filled'}
              optionRender={(item) => (
                <Flexbox horizontal align={'center'} gap={8}>
                  <EngineAvatar engine={item.value as string} />
                  {item.value}
                </Flexbox>
              )}
              options={Object.keys(ENGINE_ICON_MAP).map((item) => ({
                label: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <EngineAvatar engine={item} />
                  </Flexbox>
                ),
                value: item,
              }))}
              onChange={(checkedValue) => {
                setEngines(checkedValue);
              }}
            />
          ) : (
            <Flexbox horizontal align={'flex-start'} gap={8}>
              <Text className={styles.textHeader} type={'secondary'}>
                {t('search.searchEngine.title')}
              </Text>
              <Checkbox.Group
                value={engines}
                options={Object.keys(ENGINE_ICON_MAP).map((item) => ({
                  label: (
                    <Flexbox horizontal align={'center'} gap={8}>
                      <EngineAvatar engine={item} />
                      {item}
                    </Flexbox>
                  ),
                  value: item,
                }))}
                onChange={(checkedValue) => {
                  setEngines(checkedValue);
                }}
              />
            </Flexbox>
          )}

          {isMobile ? (
            <Select
              mode="multiple"
              placeholder={t('search.searchCategory.placeholder')}
              size="small"
              value={categories}
              variant="filled"
              optionRender={(item) => (
                <Flexbox horizontal align={'center'} gap={8}>
                  <CategoryAvatar category={item.value as string} />
                  {t(`search.searchCategory.value.${item.value}` as any)}
                </Flexbox>
              )}
              options={Object.keys(CATEGORY_ICON_MAP).map((item) => ({
                label: (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <CategoryAvatar category={item as any} />
                    {t(`search.searchCategory.value.${item}` as any)}
                  </Flexbox>
                ),
                value: item,
              }))}
              onChange={(checkedValue) => {
                setCategories(checkedValue);
              }}
            />
          ) : (
            <Flexbox horizontal align="flex-start" gap={8}>
              <Text className={styles.textHeader} type={'secondary'}>
                {t('search.searchCategory.title')}
              </Text>
              <Checkbox.Group
                value={categories}
                options={Object.keys(CATEGORY_ICON_MAP).map((item) => ({
                  label: (
                    <Flexbox horizontal align={'center'} gap={8}>
                      <CategoryAvatar category={item as any} />
                      {t(`search.searchCategory.value.${item}` as any)}
                    </Flexbox>
                  ),
                  value: item,
                }))}
                onChange={(checkedValue) => setCategories(checkedValue)}
              />
            </Flexbox>
          )}

          <Flexbox horizontal align={'center'} gap={16} wrap={'wrap'}>
            <Text className={styles.textHeader} type={'secondary'}>
              {t('search.searchTimeRange.title')}
            </Text>
            <Segmented
              value={time_range}
              options={[
                { label: t('search.searchTimeRange.value.anytime'), value: 'anytime' },
                { label: t('search.searchTimeRange.value.day'), value: 'day' },
                { label: t('search.searchTimeRange.value.week'), value: 'week' },
                { label: t('search.searchTimeRange.value.month'), value: 'month' },
                { label: t('search.searchTimeRange.value.year'), value: 'year' },
              ]}
              onChange={(e) => setTimeRange(e as any)}
            />
          </Flexbox>
        </Block>
      </>
    );
  },
);
export default SearchBar;
