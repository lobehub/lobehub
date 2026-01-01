import { type InputProps, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface SearchProps {
  onChange: (value: string) => void;
  value: string;
  variant?: InputProps['variant'];
}

const Search = memo<SearchProps>(({ value, onChange, variant }) => {
  const { t } = useTranslation('modelProvider');

  return (
    <SearchBar
      allowClear
      defaultValue={value}
      onSearch={(keyword) => onChange(keyword)}
      placeholder={t('providerModels.list.search')}
      size={'small'}
      variant={variant}
    />
  );
});
export default Search;
