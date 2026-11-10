import { Icon, Input, stopPropagation } from '@lobehub/ui';
import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SEARCH_DEBOUNCE_MS = 180;

interface SkillsSearchBarProps {
  /** Must be stable: it receives the debounced query, and '' on unmount. */
  onSearch: (query: string) => void;
}

// Keystrokes stay local to this component: only the debounced query reaches the
// host, so typing never re-renders the skill rows.
const SkillsSearchBar = ({ onSearch }: SkillsSearchBarProps) => {
  const { t } = useTranslation('chat');
  const [value, setValue] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onSearch, value]);

  // The input remounts empty, so the host must not keep filtering by the old query.
  useEffect(() => () => onSearch(''), [onSearch]);

  return (
    <Input
      allowClear
      aria-label={t('workingPanel.skills.searchPlaceholder')}
      placeholder={t('workingPanel.skills.searchPlaceholder')}
      prefix={<Icon icon={SearchIcon} size={13} />}
      size={'small'}
      style={{ flexShrink: 0 }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(event) => {
        stopPropagation(event);
        if (event.key === 'Escape') setValue('');
      }}
    />
  );
};

export default SkillsSearchBar;
