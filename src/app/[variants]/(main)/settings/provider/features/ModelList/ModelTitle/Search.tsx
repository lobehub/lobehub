import { InputProps, SearchBar } from '@lobehub/ui';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SearchProps {
  onChange: (value: string) => void;
  value: string;
  variant?: InputProps['variant'];
}

const Search = memo<SearchProps>(({ value, onChange, variant }) => {
  const { t } = useTranslation('modelProvider');

  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <SearchBar
      allowClear
      onBlur={() => {
        // 失焦即触发搜索
        if (text !== value) onChange(text);
      }}
      // 用户输入时仅更新本地，不立即触发搜索（保持原先需要回车/搜索图标的行为）
      onChange={(e) => {
        const v = e?.target?.value ?? '';
        setText(v);
      }}
      onSearch={(keyword) => {
        setText(keyword);
        onChange(keyword);
      }}
      placeholder={t('providerModels.list.search')}
      size={'small'}
      value={text}
      variant={variant}
    />
  );
});
export default Search;
