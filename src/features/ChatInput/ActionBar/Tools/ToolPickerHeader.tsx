import { Flexbox, SearchBar, Segmented, Text } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Filter = 'auto' | 'disabled';

interface ToolPickerHeaderProps {
  action?: ReactNode;
  empty: boolean;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onSearchChange: (query: string) => void;
  query: string;
  showFilter?: boolean;
}

export const ToolPickerHeader = memo<ToolPickerHeaderProps>(
  ({ action, empty, filter, query, showFilter = true, onFilterChange, onSearchChange }) => {
    const { t } = useTranslation('setting');
    const searching = Boolean(query.trim());

    const searchInput = (
      <SearchBar
        allowClear
        aria-label={t('tools.picker.search')}
        placeholder={t('tools.picker.search')}
        size="small"
        style={action ? { flex: 1, minWidth: 0 } : undefined}
        value={query}
        variant="borderless"
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={(event) => {
          if (!['Escape', 'Tab', 'ArrowDown'].includes(event.key)) event.stopPropagation();
        }}
      />
    );

    return (
      <Flexbox className="lobe-tool-picker-header" gap={6}>
        {action ? (
          <Flexbox horizontal align="center" gap={4}>
            {searchInput}
            {action}
          </Flexbox>
        ) : (
          searchInput
        )}
        {showFilter && !searching && (
          <Segmented
            block
            size="small"
            value={filter}
            options={[
              { label: t('tools.status.enabled'), value: 'auto' },
              { label: t('tools.status.disabled'), value: 'disabled' },
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
