import { Flexbox, Icon, SearchBar, Select } from '@lobehub/ui';
import { ArrowDownNarrowWide, Search } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface SortOption {
  label: string;
  value: string;
}

interface FilterBarProps {
  onSearch: (value: string) => void;
  onSortChange?: (sort: string) => void;
  searchValue: string;
  sortOptions?: SortOption[];
  sortValue?: string;
}

const FilterBar = memo<FilterBarProps>(
  ({ searchValue, onSearch, sortValue, onSortChange, sortOptions }) => {
    const { t } = useTranslation('memory');

    return (
      <Flexbox horizontal align={'center'} gap={12}>
        <SearchBar
          allowClear
          defaultValue={searchValue}
          placeholder={t('filter.search')}
          prefix={<Search size={16} />}
          style={{ flex: 1 }}
          onSearch={(v) => onSearch(v)}
          onInputChange={(v) => {
            if (!v) {
              onSearch(v);
            }
          }}
        />
        {sortOptions && sortOptions.length > 0 && onSortChange && (
          <Select
            options={sortOptions}
            prefix={<Icon icon={ArrowDownNarrowWide} style={{ marginRight: 4 }} />}
            style={{ minWidth: 150 }}
            value={sortValue}
            onChange={(value) => onSortChange(value as string)}
          />
        )}
      </Flexbox>
    );
  },
);

export default FilterBar;
