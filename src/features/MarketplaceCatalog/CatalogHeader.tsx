import { Flexbox, SearchBar, Select, Text } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ListFilter } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

const styles = stylex.create({
  category: {
    maxWidth: '100%',
    width: { 'default': 224, '@media (max-width: 600px)': '100%' },
  },
  toolbar: {
    alignItems: 'center',
    display: 'flex',
    flexDirection: { 'default': 'row', '@media (max-width: 600px)': 'column' },
    gap: 8,
  },
  searchSlot: { flex: '1', minWidth: 0, width: '100%' },
});

interface CatalogHeaderProps {
  action: ReactNode;
  categories: { key: string; label: string }[];
  description: string;
  searchLabel: string;
  title: string;
}

export const CatalogHeader = ({
  action,
  categories,
  description,
  searchLabel,
  title,
}: CatalogHeaderProps) => {
  const { t } = useTranslation('discover');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState({ q, word: q });
  if (draft.q !== q) setDraft({ q, word: q });

  const filter = (key: 'category' | 'q', value: string) => {
    if (value === (params.get(key) ?? '')) return;
    const next = new URLSearchParams(params);
    next.delete('page');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <Flexbox gap={20}>
      <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
        <Flexbox gap={4} style={{ flex: '1 1 220px' }}>
          <Text as="h1" fontSize={28} weight={600}>
            {title}
          </Text>
          <Text type="secondary">{description}</Text>
        </Flexbox>
        {action}
      </Flexbox>
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.searchSlot)}>
          <SearchBar
            aria-label={searchLabel}
            data-testid="search-bar"
            enterKeyHint="search"
            placeholder={searchLabel}
            style={{ width: '100%' }}
            value={draft.word}
            variant="outlined"
            onSearch={(word) => filter('q', word.trim())}
            onInputChange={(word) => {
              setDraft({ q, word });
              if (!word) filter('q', '');
            }}
          />
        </div>
        <Select
          showSearch
          className={stylex.props(styles.category).className}
          options={categories.map(({ key, label }) => ({ label, value: key }))}
          placeholder={t('catalog.allCategories')}
          prefix={ListFilter}
          value={params.get('category')}
          onChange={(value) => {
            if (typeof value === 'string') filter('category', value);
          }}
        />
      </div>
    </Flexbox>
  );
};
