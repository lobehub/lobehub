import { Flexbox, SearchBar, Segmented, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type Filter = 'auto' | 'disabled';

interface ToolPickerHeaderProps {
  empty: boolean;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onSearchChange: (query: string) => void;
  query: string;
}

export const ToolPickerHeader = memo<ToolPickerHeaderProps>(
  ({ empty, filter, query, onFilterChange, onSearchChange }) => {
    const { t } = useTranslation('setting');
    const searching = Boolean(query.trim());

    return (
      <Flexbox className="lobe-tool-picker-header" gap={6}>
        <SearchBar
          allowClear
          aria-label={t('tools.picker.search')}
          placeholder={t('tools.picker.search')}
          size="small"
          value={query}
          variant="borderless"
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (!['Escape', 'Tab', 'ArrowDown'].includes(event.key)) event.stopPropagation();
          }}
        />
        {!searching && (
          <Segmented
            block
            size="small"
            value={filter}
            options={[
              { label: t('tools.loading.onDemand'), value: 'auto' },
              { label: t('tools.loading.never'), value: 'disabled' },
            ]}
            onChange={(value) => onFilterChange(value === 'disabled' ? 'disabled' : 'auto')}
          />
        )}
        {empty && (
          <Flexbox align="center" paddingBlock={16} role="status">
            <Text fontSize={13} type="secondary">
              {searching ? t('tools.picker.noMatches') : t('tools.picker.emptyGroup')}
            </Text>
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

ToolPickerHeader.displayName = 'ToolPickerHeader';
