import { type InputProps } from '@lobehub/ui';
import { SearchBar } from '@lobehub/ui';
import { useDebounce } from 'ahooks';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SearchProps {
  onChange: (value: string) => void;
  value: string;
  variant?: InputProps['variant'];
}

const Search = memo<SearchProps>(({ value, onChange, variant }) => {
  const { t } = useTranslation('modelProvider');
  const [localValue, setLocalValue] = useState(value);
  const debouncedValue = useDebounce(localValue, { wait: 200 });
  const skipDebouncedEmitRef = useRef(false);

  useEffect(() => {
    skipDebouncedEmitRef.current = true;
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (skipDebouncedEmitRef.current) {
      skipDebouncedEmitRef.current = false;

      return;
    }

    if (!localValue) {
      if (value) onChange('');

      return;
    }

    if (debouncedValue === value) return;

    onChange(debouncedValue);
  }, [debouncedValue, localValue, onChange, value]);

  return (
    <SearchBar
      allowClear
      placeholder={t('providerModels.list.search')}
      size={'small'}
      value={localValue}
      variant={variant}
      onInputChange={setLocalValue}
    />
  );
});
export default Search;
